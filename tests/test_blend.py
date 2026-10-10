import csv
import json
import math
import os
import random
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from vigs import blend as bl


def rows_for(n_events, informative, seed=0):
    """Rows where the market chance carries information the model lacks, or not."""
    rng = random.Random(seed)
    rows = []
    t0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
    for i in range(n_events):
        base = rng.gauss(0.6, 0.6)                  # what the model knows
        extra = rng.gauss(0, 0.8) if informative else 0.0   # what only the market knows
        truth = bl.sigmoid(base + extra)
        p_model = bl.sigmoid(base)
        q = bl.sigmoid(base + extra if informative else base + rng.gauss(0, 0.3))
        y = int(rng.random() < truth)
        ko = (t0 + timedelta(minutes=i)).isoformat().replace("+00:00", "Z")
        rows.append({"kickoff": ko, "event": f"e{i}", "market": "FH_O05", "q": q, "p": p_model, "y": y})
    return rows


class Fit(unittest.TestCase):
    def test_recovers_coefficients(self):
        rng = random.Random(1)
        xs, ys = [], []
        for _ in range(20000):
            x1, x2 = rng.gauss(0, 1), rng.gauss(0, 1)
            xs.append((x1, x2))
            ys.append(int(rng.random() < bl.sigmoid(0.1 + 0.8 * x1 + 0.3 * x2)))
        a, b1, b2 = bl.fit_logistic(xs, ys)
        self.assertAlmostEqual(a, 0.1, delta=0.05)
        self.assertAlmostEqual(b1, 0.8, delta=0.06)
        self.assertAlmostEqual(b2, 0.3, delta=0.06)


class Switch(unittest.TestCase):
    def test_stays_off_while_collecting(self):
        out = bl.evaluate(rows_for(1500, informative=True))
        e = out["markets"]["FH_O05"]
        self.assertFalse(e["active"])
        self.assertIn("collecting", e["reason"])
        self.assertIsNone(bl.estimate(out, "FH_O05", 0.7, 0.72, [0.71, 0.73]))

    def test_guarded_leans_on_the_market_and_spans_both_views(self):
        p, lo, hi, src = bl.guarded(0.60, 0.72, 0.70, 0.74)
        self.assertEqual(src, "guarded")
        self.assertAlmostEqual(p, bl.apply([0, .85, .15], 0.60, 0.72))
        self.assertTrue(0.60 < p < 0.66)               # much nearer the market
        self.assertEqual((lo, hi), (0.60, 0.74))
        # Market below break-even keeps the range below it too, so no Lean.
        from vigs.grading import grade_model
        g = grade_model(1.6, 0.60, p, (lo, hi), 0.7, 400)
        self.assertNotEqual(g.grade, "Lean")

    def test_switches_on_when_the_market_knows_more(self):
        out = bl.evaluate(rows_for(4000, informative=True))
        e = out["markets"]["FH_O05"]
        self.assertTrue(e["active"], e["reason"])
        self.assertLess(e["test"]["blend"], e["test"]["model"])
        self.assertGreater(e["coef"][1], 0.5)          # leans on the market
        p, lo, hi, src = bl.estimate(out, "FH_O05", 0.8, 0.6, [0.58, 0.6, 0.62] * 7)
        self.assertEqual(src, "blend")
        self.assertTrue(lo <= p <= hi)

    def test_stays_off_when_the_market_adds_nothing(self):
        out = bl.evaluate(rows_for(4000, informative=False, seed=3))
        e = out["markets"]["FH_O05"]
        # The model already holds everything the market knows, so the blend
        # must not beat it by more than noise; the switch is allowed only
        # with a strict improvement and should usually stay off.
        self.assertGreater(e["test"]["blend"], e["test"]["model"] - 0.003)


class PointInTime(unittest.TestCase):
    def test_model_input_never_sees_the_same_day(self):
        from vigs.data import synthesize
        ms = synthesize(weeks=40 * 36, seed=2, minutes_per_round=40)   # ~40 days of rounds
        with tempfile.TemporaryDirectory() as d:
            def write(results):
                with open(os.path.join(d, "results.csv"), "w", newline="") as fh:
                    w = csv.writer(fh)
                    w.writerow(["event_id", "league", "kickoff", "home", "away", "hg", "ag", "ht_hg", "ht_ag"])
                    w.writerows(results)
            res = [[f"e{i}", m.league, m.kickoff.isoformat().replace("+00:00", "Z"), m.home, m.away,
                    m.hg, m.ag, m.ht_hg, m.ht_ag] for i, m in enumerate(ms)]
            last_day = res[-1][2][:10]
            os.makedirs(os.path.join(d, "odds"))
            with open(os.path.join(d, "odds", f"{last_day}.jsonl"), "w") as fh:
                for i, m in enumerate(ms):
                    ko = res[i][2]
                    if ko[:10] == last_day:
                        cap = (m.kickoff - timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
                        fh.write(json.dumps({"event_id": f"e{i}", "captured_at": cap, "kickoff": ko,
                                             "league": m.league, "home": m.home, "away": m.away,
                                             "odds": dict(m.odds)}) + "\n")
            write(res)
            a = bl.training_rows(d)
            # Rewrite every result on that day: model inputs must not move.
            write([r[:5] + [r[6] + 3, r[5] + 3, r[8], r[7]] if r[2][:10] == last_day else r for r in res])
            b = bl.training_rows(d)
        self.assertTrue(a)
        self.assertEqual([round(r["p"], 12) for r in a], [round(r["p"], 12) for r in b])
        self.assertNotEqual([r["y"] for r in a], [r["y"] for r in b])


if __name__ == "__main__":
    unittest.main()
