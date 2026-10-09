import os
import re
import tempfile
import unittest

from vigs.data import market_from_column, market_label, synthesize
from vigs.evidence import analyze, grade_obs, observe
from vigs.grading import GradeConfig, grade
from vigs.ledger import Ledger, LedgerError, summarize
from vigs.odds import combined_odds, combined_prob, devig, house_cut
from vigs.sheet import SheetQuery, build_sheet
from vigs.stats import beta_ppf, betainc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Over 1.5 at 1.10 with an under price of 7.50: market chance about 87%.
O15_ODDS, O15_MARKET = 1.10, devig([1.10, 7.50])[0]


class GoldenGrades(unittest.TestCase):
    def test_below_break_even_is_avoid(self):
        g = grade(O15_ODDS, O15_MARKET, 2000, 1740, validated=True, fdr_pass=True,
                  collected_days=60)
        self.assertEqual(g.grade, "Avoid")

    def test_large_validated_sample_above_break_even_is_solid(self):
        g = grade(O15_ODDS, O15_MARKET, 3000, 2820, validated=True, fdr_pass=True,
                  collected_days=60)
        self.assertEqual(g.grade, "Solid")
        self.assertGreater(g.edge, 0)

    def test_small_sample_is_never_solid(self):
        for v, f in ((True, True), (False, False), (None, None)):
            g = grade(O15_ODDS, O15_MARKET, 40, 38, validated=v, fdr_pass=f, collected_days=60)
            self.assertIn(g.grade, ("Rough", "Lean"))

    def test_young_data_caps_at_lean(self):
        g = grade(O15_ODDS, O15_MARKET, 3000, 2820, validated=True, fdr_pass=True,
                  collected_days=5)
        self.assertEqual(g.grade, "Lean")
        self.assertEqual(g.missed, ["data collected"])

    def test_every_grade_explains_itself(self):
        g = grade(O15_ODDS, O15_MARKET, 3000, 2820)
        self.assertEqual(len(g.tests), 5)
        self.assertTrue(all(t.detail for t in g.tests))
        lo, hi = g.interval()
        self.assertLess(lo, g.estimate)
        self.assertLess(g.estimate, hi)


class OddsMaths(unittest.TestCase):
    def test_golden_slip(self):
        odds, chances = [1.62, 1.85, 1.74], [0.551, 0.500, 0.527]
        self.assertAlmostEqual(combined_odds(odds), 5.21, places=2)
        self.assertAlmostEqual(combined_prob(chances), 0.145, places=3)
        self.assertAlmostEqual(house_cut(odds, chances), 0.243, places=3)

    def test_shin_sums_to_one_and_shades_longshots(self):
        odds = [1.30, 5.0, 11.0]
        prop, shin = devig(odds), devig(odds, "shin")
        self.assertAlmostEqual(sum(shin), 1.0)
        self.assertGreater(shin[0], prop[0])     # favourite gets more than proportional
        self.assertLess(shin[2], prop[2])        # longshot less

    def test_betainc_closed_forms(self):
        for x in (0.1, 0.5, 0.93):
            self.assertAlmostEqual(betainc(3, 1, x), x ** 3, places=10)
            self.assertAlmostEqual(betainc(1, 4, x), 1 - (1 - x) ** 4, places=10)
        self.assertAlmostEqual(betainc(2994.4, 205.6, beta_ppf(0.95, 2994.4, 205.6)), 0.95, 6)


class Markets(unittest.TestCase):
    def test_columns_and_labels(self):
        self.assertEqual(market_from_column("odds_fh_o05"), "FH_O05")
        self.assertEqual(market_from_column("odds_u25"), "U25")
        self.assertIsNone(market_from_column("odds_weird"))
        self.assertEqual(market_label("FH_O05"), "First half over 0.5")
        self.assertEqual(market_label("O15"), "Over 1.5")


class EvidenceEngine(unittest.TestCase):
    def test_contexts_ignore_the_future(self):
        base = synthesize(weeks=30, seed=4)
        alt = synthesize(weeks=30, seed=4)
        for m in alt:
            if m.t >= 20:
                m.hg, m.ag = m.ag + 2, m.hg + 3
        a = [(o.match.key(), o.market, sorted(o.ctx.items())) for o in observe(base) if o.t <= 20]
        b = [(o.match.key(), o.market, sorted(o.ctx.items())) for o in observe(alt) if o.t <= 20]
        self.assertEqual(a, b)

    def test_noise_league_has_no_solid_slice(self):
        for seed in (1, 2):
            an, _ = analyze(synthesize(weeks=200, seed=seed, minutes_per_round=300))
            self.assertGreater(an.collected_days, 30)
            solid = [k for k, s in an.slices.items() if s.n >= 300 and an.grade_slice(k).grade == "Solid"]
            self.assertEqual(solid, [], seed)

    def test_mispriced_market_reaches_solid_and_noise_says_nothing_clears(self):
        ms = synthesize(weeks=302, played=300, seed=4, skew={"O15": 1.15}, minutes_per_round=200)
        an, obs = analyze(ms)
        picks = [grade_obs(o, an) for o in obs if o.hit is None]
        sheet = build_sheet(picks, SheetQuery({"O15"}, count=3, min_grade="Solid"))
        self.assertEqual(len(sheet.picks), 3)
        self.assertTrue(all(p.graded.grade == "Solid" for p in sheet.picks))
        # True edge is about 1.15 / 1.06 - 1 = 8.5%; estimates should be near it, not inflated.
        self.assertTrue(all(0 < p.graded.edge < 0.2 for p in sheet.picks))

        noise = synthesize(weeks=62, played=60, seed=3)
        an, obs = analyze(noise)
        picks = [grade_obs(o, an) for o in obs if o.hit is None]
        sheet = build_sheet(picks, SheetQuery({"O15"}, count=3, min_grade="Solid"))
        self.assertEqual(sheet.picks, [])
        self.assertTrue(sheet.note.startswith("Nothing clears the Solid bar"))


class LedgerRules(unittest.TestCase):
    def _pick(self):
        return {"market": "O15", "odds": 1.4, "break_even": 1 / 1.4, "market_prob": 0.7,
                "estimate": 0.72, "grade": "Lean"}

    def test_append_only_settle_and_tamper(self):
        ms = synthesize(weeks=3, played=2, seed=1)
        upcoming = [m for m in ms if not m.settled]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "l.jsonl")
            led = Ledger(path)
            with self.assertRaises(LedgerError):
                led.add_pick(self._pick(), ms[0])           # already played
            led.add_pick(self._pick(), upcoming[0])
            for m in upcoming:
                m.hg, m.ag, m.ht_hg, m.ht_ag = 2, 1, 1, 0
            self.assertEqual(Ledger(path).settle(upcoming), (1, 0))
            self.assertEqual(Ledger(path).settle(upcoming), (0, 0))   # never settled twice
            rec = [r for r in summarize(Ledger(path)) if r.grade == "Lean"][0]
            self.assertEqual((rec.n, rec.hits), (1, 1))
            with open(path) as fh:
                lines = fh.readlines()
            lines[0] = lines[0].replace('"odds": 1.4', '"odds": 2.4')
            with open(path, "w") as fh:
                fh.writelines(lines)
            with self.assertRaises(LedgerError):
                Ledger(path)


class BannedWords(unittest.TestCase):
    BANNED = re.compile(r"\b(sure|banker|guaranteed|fixed|lock|hack)\b|can't lose|100%", re.I)

    def test_no_banned_words_in_product_text(self):
        files = [os.path.join(ROOT, "README.md")]
        pkg = os.path.join(ROOT, "vigs")
        files += [os.path.join(pkg, f) for f in os.listdir(pkg) if f.endswith(".py")]
        for sub in ("web/app", "web/lib", "web/app/login"):
            d = os.path.join(ROOT, sub)
            if os.path.isdir(d):
                files += [os.path.join(d, f) for f in os.listdir(d) if f.endswith((".ts", ".tsx"))]
        hits = []
        for path in files:
            with open(path, encoding="utf-8") as fh:
                for i, line in enumerate(fh, 1):
                    if self.BANNED.search(line):
                        hits.append(f"{os.path.basename(path)}:{i}: {line.strip()}")
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
