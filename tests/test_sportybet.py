import json
import os
import tempfile
import unittest

from vigs.data import load_csv
from vigs.sportybet import append_results, build, parse_odds, parse_result, snapshot

# Shapes follow SportyBet's factsCenter API; values are made up for the test.
SPORT = {"id": "sr:sport:202120001", "name": "vFootball",
         "category": {"id": "sv:category:202120001", "name": "England"}}


def market(mid, outcomes, spec=None, status=0):
    return {"id": mid, "specifier": spec, "status": status,
            "outcomes": [{"desc": d, "odds": o, "isActive": a} for d, o, a in outcomes]}


EVENT = {
    "eventId": "sr:match:1", "estimateStartTime": 1_800_000_000_000, "homeTeamName": "AAA",
    "awayTeamName": "BBB", "sport": SPORT, "markets": [
        market("1", [("Home", "2.10", 1), ("Draw", "3.40", 1), ("Away", "3.30", 1)]),
        market("18", [("Over 1.5", "1.30", 1), ("Under 1.5", "3.40", 1)], "total=1.5"),
        market("18", [("Over 6.5", "23.0", 1), ("Under 6.5", "1.00", 0)], "total=6.5"),
        market("68", [("Over 0.5", "1.25", 1), ("Under 0.5", "4.10", 1)], "total=0.5"),
        market("29", [("Yes", "1.95", 1), ("No", "1.85", 1)]),
        market("60", [("Home", "3.0", 1), ("Draw", "2.2", 1), ("Away", "3.5", 1)]),
    ]}
RESULT = {"eventId": "sr:match:1", "estimateStartTime": 1_800_000_000_000, "matchStatus": "End",
          "setScore": "2:1", "regularTimeScore": ["1:0", "1:1"], "homeTeamName": "AAA",
          "awayTeamName": "BBB", "sport": SPORT}


class Parsing(unittest.TestCase):
    def test_odds_mapping_and_inactive_groups(self):
        odds = parse_odds(EVENT)
        self.assertEqual(odds["1"], 2.10)
        self.assertEqual((odds["O15"], odds["U15"]), (1.30, 3.40))
        self.assertEqual(odds["FH_O05"], 1.25)
        self.assertEqual((odds["BY"], odds["BN"]), (1.95, 1.85))
        self.assertNotIn("O65", odds)              # an outcome was suspended
        self.assertNotIn("FH_1", odds)             # unsupported market ignored

    def test_result_with_half_time(self):
        r = parse_result(RESULT)
        self.assertEqual((r["hg"], r["ag"], r["ht_hg"], r["ht_ag"]), (2, 1, 1, 0))
        self.assertIsNone(parse_result(dict(RESULT, matchStatus="Live")))


class Build(unittest.TestCase):
    def test_join_uses_only_pre_kickoff_odds(self):
        kick = EVENT["estimateStartTime"]
        before = snapshot(EVENT, kick - 600_000)
        late = dict(snapshot(EVENT, kick + 60_000))
        late["odds"] = dict(late["odds"], **{"1": 9.99})
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "odds"))
            with open(os.path.join(d, "odds", "2027-01-15.jsonl"), "w") as fh:
                fh.write(json.dumps(before) + "\n" + json.dumps(late) + "\n")
            append_results(os.path.join(d, "results.csv"), [parse_result(RESULT)])
            hist, up = os.path.join(d, "h.csv"), os.path.join(d, "u.csv")
            self.assertEqual(build(d, hist, up), (1, 0, 0))
            m = load_csv(hist)[0]
            self.assertEqual(m.odds["1"], 2.10)
            self.assertEqual((m.hg, m.ag, m.ht_hg, m.ht_ag), (2, 1, 1, 0))
            self.assertEqual(m.league, "England")
            self.assertTrue(m.outcome("FH_O05"))




class Study(unittest.TestCase):
    def test_memoryless_league_shows_no_memory(self):
        from vigs.data import synthesize
        from vigs.study import base_rates, hour_tests, memory_tests
        rows = [{"event_id": str(i), "league": m.league,
                 "kickoff": m.kickoff.isoformat().replace("+00:00", "Z"), "home": m.home,
                 "away": m.away, "hg": m.hg, "ag": m.ag, "ht_hg": m.ht_hg, "ht_ag": m.ht_ag}
                for i, m in enumerate(synthesize(weeks=400, seed=2, minutes_per_round=40))]
        effects = memory_tests(rows) + hour_tests(rows)
        self.assertEqual([e.name for e in effects if e.q < 0.10], [])
        (_, n, rates), = base_rates(rows)
        self.assertEqual(n, 4000)
        self.assertAlmostEqual(rates["home"] + rates["draw"] + rates["away"], 1.0)


class Record(unittest.TestCase):
    def test_scorecard_counts_and_curve(self):
        from vigs.data import synthesize
        from vigs.ledger import Ledger
        from vigs.record import export_record
        ms = synthesize(weeks=2, played=1, seed=3)
        upcoming = [m for m in ms if not m.settled][:4]
        with tempfile.TemporaryDirectory() as d:
            led = Ledger(os.path.join(d, "l.jsonl"))
            for i, m in enumerate(upcoming):
                led.add_pick({"market": "O15", "odds": 1.5, "break_even": 1 / 1.5, "market_prob": 0.62,
                              "estimate": 0.7, "grade": "Lean" if i < 3 else "Rough",
                              "ci_low": 0.68, "ci_high": 0.72 if i < 3 else 0.9}, m)
            for i, m in enumerate(upcoming[:3]):
                m.hg, m.ag = (2, 1) if i < 2 else (0, 0)
            led.settle(upcoming)
            rec = export_record(Ledger(led.path))
        lean = rec["grades"]["Lean"]
        self.assertEqual((lean["settled"], lean["hits"], lean["open"]), (3, 2, 0))
        self.assertAlmostEqual(lean["roi"], (0.5 + 0.5 - 1) / 3)
        self.assertEqual(rec["grades"]["Rough"]["open"], 1)
        self.assertEqual(rec["curve"]["Lean"][-1][1], 0.0)
        self.assertTrue(rec["chain"]["verified"])
        self.assertEqual(len(rec["recent"]), 4)
        self.assertEqual(rec["confidence"]["High"]["settled"], 3)
        self.assertEqual(rec["confidence"]["Low"]["open"], 1)


class BookedCodes(unittest.TestCase):
    def test_copied_once_scored_before_kickoff_and_settled(self):
        from vigs.ledger import Ledger
        from vigs.record import export_record
        from vigs.sportybet import results_matches_row
        booked = 1_800_000_000_000
        entry = {"code": "ABC123", "user": "me", "origin": "tonight", "booked_at": booked, "legs": [
            {"event_id": "e1", "market": "O15", "kickoff": booked + 60_000, "odds": 1.5, "estimate": 0.7, "market_prob": 0.65},
            {"event_id": "e2", "market": "FH_O05", "kickoff": booked + 60_000, "odds": 1.4, "estimate": 0.72, "market_prob": 0.7},
            {"event_id": "e3", "market": "X", "kickoff": booked - 60_000, "odds": 3.3, "estimate": 0.28, "market_prob": 0.29}]}
        row = lambda e, hg, ag, h1, a1: {"event_id": e, "league": "England", "kickoff": "2027-01-15T08:00:00Z",
                                         "home": "A", "away": "B", "hg": hg, "ag": ag, "ht_hg": h1, "ht_ag": a1}
        with tempfile.TemporaryDirectory() as d:
            led = Ledger(os.path.join(d, "l.jsonl"))
            self.assertTrue(led.add_user_code(entry))
            self.assertFalse(led.add_user_code(entry))               # copied once
            legs = led.user_codes()["ABC123@1800000000000"]["legs"]
            self.assertEqual([l["scored"] for l in legs], [True, True, False])  # e3 had kicked off
            res = {"e1": results_matches_row(row("e1", "2", "1", "1", "0"))}
            self.assertEqual(led.settle_user_codes(res), 0)           # e2 still open
            res["e2"] = results_matches_row(row("e2", "0", "1", "0", "1"))
            self.assertEqual(led.settle_user_codes(res), 1)
            rec = export_record(Ledger(led.path))
        mc = rec["mycodes"]
        self.assertEqual((mc["codes"], mc["settled"], mc["landed"]), (1, 1, 1))
        self.assertAlmostEqual(mc["roi"], 1.5 * 1.4 - 1)
        self.assertEqual((mc["legs"]["settled"], mc["legs"]["hits"]), (2, 2))




class Insights(unittest.TestCase):
    def test_bands_margins_and_leagues(self):
        import json
        from vigs.insights import export_insights
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "odds"))
            with open(os.path.join(d, "results.csv"), "w") as fh:
                fh.write("event_id,league,kickoff,home,away,hg,ag,ht_hg,ht_ag\n"
                         "e1,Spain,2026-10-10T08:00:00Z,A,B,1,1,0,1\ne2,Spain,2026-10-10T08:00:00Z,C,D,0,0,0,0\n")
            with open(os.path.join(d, "odds", "2026-10-10.jsonl"), "w") as fh:
                for e in ("e1", "e2"):
                    fh.write(json.dumps({"event_id": e, "league": "Spain", "home": "A", "away": "B",
                                         "kickoff": "2026-10-10T08:00:00Z", "captured_at": "2026-10-10T07:50:00Z",
                                         "odds": {"1": 2.5, "X": 3.2, "2": 2.9}}) + "\n")
            out = export_insights(d)
        self.assertEqual(out["matches_with_odds"], 2)
        self.assertAlmostEqual(out["margins"][0]["margin"], 1 / 2.5 + 1 / 3.2 + 1 / 2.9 - 1)
        draws = next(b for b in out["bands"] if b["lo"] == 3.0)   # the draw at 3.2: both games drawn
        self.assertEqual((draws["n"], draws["landed"]), (2, 1.0))
        self.assertAlmostEqual(draws["roi"], 2.2)
        sides = next(b for b in out["bands"] if b["lo"] == 2.0)   # home 2.5 and away 2.9: neither won
        self.assertEqual((sides["n"], sides["landed"], sides["roi"]), (4, 0.0, -1.0))
        self.assertEqual(out["leagues"][0]["draw"], 1.0)
        self.assertEqual(out["leagues"][0]["nil_nil"], 0.5)


if __name__ == "__main__":
    unittest.main()
