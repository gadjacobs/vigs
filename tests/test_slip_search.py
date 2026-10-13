import itertools
import math
import random
import unittest

from vigs.odds import likeliest_slip


def brute(matches, target, lo=1.5, hi=5.0, slack=0.10):
    best, pick = -1.0, []
    choices = [[None] + [(mid, m, o, p) for m, o, p in opts if lo <= o <= hi] for mid, opts in matches]
    for combo in itertools.product(*choices):
        legs = [c for c in combo if c]
        o = math.prod(l[2] for l in legs)
        # Every slip that truly meets the target, well inside the search's ceiling.
        if o < target or o > target * math.exp(slack - 0.01):
            continue
        p = math.prod(l[3] for l in legs)
        if p > best:
            best, pick = p, legs
    return best, pick


class LikeliestSlip(unittest.TestCase):
    def matches(self, seed, n=6):
        rng = random.Random(seed)
        out = []
        for i in range(n):
            opts = []
            for m in ("1", "X", "2", "O15", "U25"):
                p = rng.uniform(0.18, 0.8)
                opts.append((m, round(1 / p * rng.uniform(0.9, 0.98), 2), p))
            out.append((f"m{i}", opts))
        return out

    def test_matches_brute_force(self):
        for seed in range(8):
            ms = self.matches(seed)
            for target in (3.0, 10.0, 40.0):
                got = likeliest_slip(ms, target)
                bp, _ = brute(ms, target)
                gp = math.prod(l[3] for l in got) if got else -1.0
                # At least as likely as any slip that meets the target.
                self.assertGreaterEqual(gp, bp - 1e-12, (seed, target))
                if got:
                    self.assertGreaterEqual(math.prod(l[2] for l in got), target * math.exp(-0.01))
                    self.assertEqual(len({l[0] for l in got}), len(got))

    def test_prefers_fewer_fairer_legs(self):
        # Two legs at 3.0 that keep 0.96 each beat five short legs that keep 0.97 each:
        # 0.96^2 > 0.97^5, at the same total price.
        ms = [(f"a{i}", [("O15", 3.0, 0.32)]) for i in range(2)] + [(f"b{i}", [("O05", 1.552, 0.625)]) for i in range(5)]
        got = likeliest_slip(ms, 9.0)
        self.assertEqual([l[0] for l in got], ["a0", "a1"])

    def test_nothing_reaches_the_target(self):
        self.assertEqual(likeliest_slip([("m", [("1", 2.0, 0.48)])], 50.0), [])


if __name__ == "__main__":
    unittest.main()
