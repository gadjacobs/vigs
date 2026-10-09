# vigs

History-backed selections for SportyBet virtual football (VFL). It answers one
question per selection: **does history say this beats its break-even, by more
than luck would explain, on data the model never saw?** Stdlib-only Python 3.10+.

Odds tell you what the bookmaker thinks and what you're paid. Over 1.5 at 1.10
needs to land 90.9% of the time just to break even. If it lands 87%, it loses
money however likely it looks. Vig flags that, and only grades a pick Solid when
the evidence clears every bar.

> Virtual leagues run on an RNG engine that very likely prices from the same
> team ratings that drive the simulation. Expect history to match market chance,
> below break-even, and expect "Nothing clears the Solid bar." That is a result.

## Words used everywhere

| term | meaning |
|---|---|
| break-even | `1 / odds`: hit rate needed to not lose money |
| market chance | implied probability with the margin removed (proportional or Shin) |
| history rate | observed hit rate in comparable past matches, with n |
| Vig estimate | history rate shrunk toward market chance (Beta prior, strength k = 200) |
| edge | `estimate × odds − 1`, also shown per ₦1,000 |

**Grades.** Solid: P(true rate > break-even) ≥ 90%, n ≥ 300, edge held walk-forward,
survives the false-discovery check (Benjamini-Hochberg 10%), ≥ 30 days of data.
Lean: estimate above break-even with P ≥ 80% but misses a Solid test (it says
which). Rough: likely, and priced for it. Avoid: history below break-even.

## Quick start (real data)

```
python -m vigs fetch results --days 30      # backfill results (scores only) into data/
python -m vigs fetch watch --minutes 120    # capture pre-match odds + new results every 4 min
python -m vigs study                        # base rates and memory tests from results alone
python -m vigs build                        # join results to their pre-kickoff odds
python -m vigs evidence data/history.csv
python -m vigs sheet data/history.csv data/upcoming.csv --market O15 --count 10
```

The data comes from SportyBet's own public web API (see `docs/feed-schema.md`).
Results reach back a year; odds exist only for the next round, so they are
collected live. `.github/workflows/collect.yml` does that around the clock on
GitHub Actions and commits to the `data` branch of this repository, which is
public: the collected data is visible to anyone.

To use the collected data: `git fetch origin data && git worktree add data origin/data`,
then run `build`, `evidence` and `sheet` as above.

## More commands

```
python -m vigs evidence history.csv                       # calibration + graded slices
python -m vigs sheet history.csv upcoming.csv --market O15 --count 10 --min-grade lean
python -m vigs sheet history.csv upcoming.csv --min-grade rough --output acca
python -m vigs ledger settle --results results.csv        # settle logged picks
python -m vigs ledger report                              # hit rate and ROI by grade
python -m vigs slip 1.62 1.85 1.74 --chances 55.1 50 52.7 # combined odds, chance, house cut
python -m unittest discover -s tests -q
```

Older pattern tools: `mine` (91 streak/regime/slot hypotheses, train/holdout),
`walkforward` (accas in a 20–50 band), `forecast`, `power`. `synth` makes
SYNTHETIC data for checking the tool, never for picks.

## Data

Chronological CSV, one row per match. Required: `week, home, away, odds_1, odds_x, odds_2`.
Optional: `league, season, kickoff` (ISO 8601, UTC unless offset given), `hg, ag`
(full time; empty for upcoming), `ht_hg, ht_ag` (needed for first-half markets),
`odds_btts_y, odds_btts_n`, and any over/under line as `odds_o15, odds_u15,
odds_fh_o05, odds_fh_u05`, … Record pre-match odds, not post-match.

`python -m vigs build` writes these files from collected data. The code
branch contains no SportyBet data; the `data` branch does.

## How a pick earns its grade

1. **Slices.** A slice is a market at a price (odds bucket, e.g. Over 1.5 at
   1.20–1.30), optionally narrowed by one context: league, stage of season,
   hour (Lagos), table-position gap, home/away team, pairing, recent form,
   previous result. Every slice includes the price, because a pooled rate over
   different prices says nothing about one selection's break-even.
2. **Point-in-time.** Contexts use only earlier rounds (tested).
3. **Shrinkage.** Beta(k·m, k·(1−m)) prior centred on the slice's market chance;
   posterior mean, 90% interval, and P(true rate > break-even).
4. **Walk-forward.** The later half of rounds is split into 5 folds; each fold is
   judged with stats frozen at its start. A slice's out-of-sample record is the
   profit of the bets it would have recommended then.
5. **False discovery.** BH at 10% across every slice tested, always across all
   markets, so narrowing a query can't loosen the bar.
6. **Ledger.** Sheets log picks before kickoff to an append-only, hash-chained
   JSONL file (shadow mode: no stakes). Editing any record breaks the chain and
   the ledger refuses to load. `ledger report` shows hit rate vs expected and ROI
   with a 90% interval per grade, and whether the Solid interval is above zero.

## What the checks show (synthetic data only)

- Pure RNG league: history matches market chance (z ≈ 0); no Solid slice across seeds;
  the best-looking `mine` pattern had +39% training ROI and +1% on the holdout.
- Over 1.5 deliberately overpriced by 15% (true edge ≈ +8.5%), 300 rounds:
  those slices reach Solid, and sheet edges come out at +10–13%, not inflated.
- Five teams scoring 65% more than their odds imply: `mine` finds it in 11 of 12
  seeds at 80 rounds. At +42% it finds it in only 2 of 12. Real edges, if any,
  need far more data than 50 gameweeks.

## Limits

- Accumulators can't validate anything: proving +10% ROI at odds ~30 needs
  ~18,500 slips. Validate legs; an acca only reshapes payoff and compounds margin.
- Picking the strongest of a selection's ~11 slices is optimistic. Solid's
  walk-forward and false-discovery tests are the guard; Lean is not.
- Pure Python handles thousands of matches in seconds. A full feed (five leagues,
  a round every few minutes) will need a database-backed version.
- Personal tool. Any public or paid release needs legal review of Nigerian gaming
  rules and SportyBet's terms first. Vig never places bets or stores credentials.
