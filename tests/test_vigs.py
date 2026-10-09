import itertools
import math
import os
import tempfile
import unittest

from vigs import backtest as bt
from vigs.data import fair_probs, load_csv, settle, synthesize, write_csv
from vigs.patterns import build_candidates
from vigs.stats import bh_qvalues, poisson_binomial_sf, required_n, z_vs_fair


class Basics(unittest.TestCase):
    def test_settle(self):
        self.assertTrue(settle("1", 2, 1) and settle("X", 1, 1) and settle("2", 0, 1))
        self.assertTrue(settle("O25", 2, 1) and settle("U25", 1, 1))
        self.assertTrue(settle("BY", 1, 1) and settle("BN", 2, 0))
        self.assertTrue(settle("O15", 1, 1) and settle("U35", 2, 1) and not settle("O05", 0, 0))
        self.assertTrue(settle("FH_O05", 2, 1, 1, 0))
        self.assertIsNone(settle("FH_O05", 2, 1))       # no half-time score: can't settle

    def test_fair_probs_sum_to_one_and_need_full_group(self):
        q = fair_probs({"1": 2.0, "X": 3.5, "2": 4.0, "O25": 1.8})
        self.assertAlmostEqual(q["1"] + q["X"] + q["2"], 1.0)
        self.assertNotIn("O25", q)

    def test_poisson_binomial_matches_brute_force(self):
        ps = [0.1, 0.5, 0.3, 0.8]
        for k in range(0, 6):
            brute = sum(math.prod(p if x else 1 - p for p, x in zip(ps, bits))
                        for bits in itertools.product([0, 1], repeat=4) if sum(bits) >= k)
            self.assertAlmostEqual(poisson_binomial_sf(k, ps), brute)

    def test_bh_monotone_and_bounded(self):
        q = bh_qvalues([0.001, 0.04, 0.5, 0.9])
        self.assertTrue(all(0 <= x <= 1 for x in q))
        self.assertLessEqual(q[0], q[1])

    def test_required_n_known_value(self):
        self.assertTrue(17000 < required_n(1 / 30, 1.1 / 30) < 20000)

    def test_z_vs_fair_zero_when_on_expectation(self):
        z, p = z_vs_fair(5, [0.5] * 10)
        self.assertAlmostEqual(z, 0.0)
        self.assertAlmostEqual(p, 0.5)


class Loader(unittest.TestCase):
    def test_roundtrip_and_upcoming(self):
        ms = synthesize(weeks=4, seed=2, played=3)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.csv")
            write_csv(path, ms)
            back = load_csv(path)
        self.assertEqual(len(back), len(ms))
        self.assertEqual(max(m.t for m in back), 3)
        self.assertTrue(all(not m.settled for m in back if m.t == 3))
        self.assertTrue(all(m.settled for m in back if m.t < 3))

    def test_rejects_bad_odds(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.csv")
            with open(path, "w") as fh:
                fh.write("week,home,away,odds_1,odds_x,odds_2\n1,A,B,0.9,3,3\n")
            with self.assertRaises(ValueError):
                load_csv(path)


class NoLookAhead(unittest.TestCase):
    def test_signals_ignore_the_future(self):
        """Changing results from week w onwards must not change any week-w signal."""
        base = synthesize(weeks=40, seed=4)
        alt = synthesize(weeks=40, seed=4)
        w = 30
        for m in alt:
            if m.t >= w:
                m.hg, m.ag = m.ag + 3, m.hg + 3
        cands = build_candidates(10)
        a, b = bt.build_bets(base, cands), bt.build_bets(alt, cands)
        for name in a:
            sa = [(x.match.label(), x.market) for x in a[name] if x.t <= w]
            sb = [(x.match.label(), x.market) for x in b[name] if x.t <= w]
            self.assertEqual(sa, sb, name)


class Detection(unittest.TestCase):
    def test_null_league_has_no_strong_pattern(self):
        strong = 0
        for seed in range(1, 7):
            ms = synthesize(weeks=60, seed=seed)
            bets = bt.build_bets(ms, build_candidates(10))
            rows, _, _ = bt.mine(bets, 60)
            strong += sum(r.verdict == "STRONG" for r in rows)
        self.assertEqual(strong, 0)

    def test_planted_edge_is_found(self):
        # +65% goals for 5 teams the odds ignore: found in 11/12 seeds at 80 rounds.
        # (At +42% it is found in only 2/12: real edges are hard to see in small samples.)
        hidden = {f"T{i:02d}": 0.5 for i in range(1, 6)}
        found = 0
        for seed in range(20, 26):
            ms = synthesize(weeks=80, seed=seed, hidden=hidden)
            bets = bt.build_bets(ms, build_candidates(10))
            rows, _, _ = bt.mine(bets, 80)
            found += any(r.name.startswith("team_bias") and r.verdict != "no evidence" for r in rows)
        self.assertGreaterEqual(found, 4)

    def test_accas_respect_odds_band(self):
        ms = synthesize(weeks=50, seed=9)
        bets = bt.build_bets(ms, build_candidates(10))
        res = bt.walk_forward(bets, 50, warmup=20, min_z=-1e9)
        self.assertTrue(res)
        self.assertTrue(all(20 <= r.odds <= 50 for r in res))
        self.assertTrue(all(len({id(b.match) for b in r.legs}) == len(r.legs) for r in res))




class Confidence(unittest.TestCase):
    def test_matches_web_plain_ts(self):
        from vigs.grading import confidence
        self.assertEqual(confidence(0.7, 0.73), "High")
        self.assertEqual(confidence(0.6, 0.74), "Low")
        self.assertEqual(confidence(0.66, 0.73), "Medium")
        self.assertEqual(confidence(0.065, 0.143), "Low")


if __name__ == "__main__":
    unittest.main()
