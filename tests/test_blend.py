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
        self.assertAlmostEqual(p, bl.apply([0, .95, .05], 0.60, 0.72))
        self.assertTrue(0.60 < p < 0.66)               # much nearer the market
        self.assertEqual((lo, hi), (0.60, 0.74))
        # Market below break-even keeps the range below it too, so no Lean.
        from vigs.grading import grade_model
        g = grade_model(1.6, 0.60, p, (lo, hi), 0.7, 400)
        self.assertNotEqual(g.grade, "Lean")

    def test_stays_off_when_the_market_alone_is_best(self):
        # The market price already holds everything: beating the model is not enough.
        out = bl.evaluate(rows_for(4000, informative=True))
        e = out["markets"]["FH_O05"]
        self.assertFalse(e["active"])
        self.assertIn("market price", e["reason"])
        self.assertGreater(e["coef"][1], 0.5)          # leans on the market

    def test_switches_on_when_each_knows_something(self):
        rng = random.Random(4)
        rows = []
        t0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
        for i in range(4000):
            u, v = rng.gauss(0.3, 0.7), rng.gauss(0.3, 0.7)   # model knows u, market knows v
            y = int(rng.random() < bl.sigmoid(u + v))
            ko = (t0 + timedelta(minutes=i)).isoformat().replace("+00:00", "Z")
            rows.append({"kickoff": ko, "event": f"e{i}", "market": "FH_O05", "q": bl.sigmoid(v + 0.3),
                         "p": bl.sigmoid(u + 0.3), "y": y})
        out = bl.evaluate(rows)
        e = out["markets"]["FH_O05"]
        self.assertTrue(e["active"], e["reason"])
        self.assertLess(e["test"]["blend"], e["test"]["market"])
        self.assertLessEqual(e["test"]["gain_q"], bl.GAIN_FDR)   # a real gain clears the false-discovery check
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


class LeanHeldOut(unittest.TestCase):
    def test_keeps_a_lean_only_when_it_holds_on_later_days(self):
        from vigs.insights import _held_out
        rng = random.Random(7)
        seen = []
        for i in range(40000):
            ko = f"2026-10-{1 + i // 4000:02d}T00:00:{i % 60:02d}Z"
            # "U35" really lands 4 points above its 0.90 price; "O15" lands as priced.
            seen.append((ko, "U35", 2, 0.90, int(rng.random() < 0.94)))
            seen.append((ko, "O15", 1, 0.70, int(rng.random() < 0.70)))
        held = _held_out(seen)
        self.assertTrue(held["U35"][0])
        self.assertGreater(held["U35"][1], 0)
        self.assertLess(abs(held["O15"][1]), 5e-4)


class FirstHalfUsual(unittest.TestCase):
    def test_usual_needs_three_recent_replays(self):
        from vigs.insights import _fh_usual
        snap = lambda e, ko, o: {"kickoff": ko, "league": "England", "home": e, "away": "X",
                                 "odds": {"FH_O05": o, "FH_U05": 4.0}}
        snaps = {f"a{i}": snap("A", f"2026-10-1{i}T10:00:00Z", 1.3) for i in range(3)}
        snaps.update({f"b{i}": snap("B", f"2026-10-1{i}T10:00:00Z", 1.3) for i in range(2)})
        out = _fh_usual(snaps)
        self.assertIn("England|A|X", out)
        self.assertNotIn("England|B|X", out)
        self.assertTrue(0.7 < out["England|A|X"] < 0.8)
