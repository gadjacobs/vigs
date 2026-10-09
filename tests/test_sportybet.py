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


if __name__ == "__main__":
    unittest.main()


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
