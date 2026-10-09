# vigs

Statistical pattern testing for virtual football leagues (SportyBet Bundesliga /
Premier League style). Stdlib-only Python 3.10+. It tells you whether a pattern
beats the bookmaker's odds *more than luck would explain*, and builds accumulators in a
chosen odds band (default 20-50) from the patterns that survive.

> Virtual leagues are normally driven by a certified RNG. The honest prior is
> that there is nothing to find. This tool exists to test that prior with
> real data, and to stop you fooling yourself when a pattern looks good by chance.

## Data

One CSV, chronological, one row per match. Real results only: nothing in this
repo is real SportyBet data.

| column | required | notes |
|---|---|---|
| `week` | yes | gameweek number (resets per season are fine) |
| `season` | no | any label; a change starts a new gameweek |
| `home`, `away` | yes | team names |
| `hg`, `ag` | for history | final score; leave both empty for upcoming fixtures |
| `odds_1`, `odds_x`, `odds_2` | yes | pre-match 1X2 odds |
| `odds_o25`, `odds_u25`, `odds_btts_y`, `odds_btts_n` | no | enables goals / BTTS patterns |

Record the odds shown **before** the match, not after.

## Commands

```
python -m vigs mine history.csv                     # top 5 patterns, train/holdout, FDR-corrected
python -m vigs walkforward history.csv              # week-by-week acca simulation, odds 20-50
python -m vigs forecast history.csv upcoming.csv    # picks + accas for the next 2 gameweeks
python -m vigs power --odds 30 --roi 0.10           # how many bets would prove an edge
python -m vigs synth --out s.csv [--plant 5]        # SYNTHETIC data to sanity-check the tool
python -m unittest -q tests.test_vigs
```

## How the testing works

- 91 candidate patterns are fixed up front (win/lose streaks, draw droughts,
  goal-total momentum/reversion, odds buckets / favourite-longshot bias,
  per-team mispricing, BTTS repeats, fixture-slot effects). The count K is known,
  so luck can be corrected for.
- Signals are point-in-time: a match only sees earlier gameweeks (unit-tested).
- Edge = hits above the **de-vigged** market probability (z-score), not raw
  win rate. ROI is reported separately because the margin must also be beaten.
- Patterns are ranked on the first 70% of weeks and re-tested on the last 30%.
  Verdict `STRONG` needs FDR q < 0.05, holdout p < 0.05 (adjusted) and positive holdout ROI.
- Walk-forward re-selects patterns every gameweek using only past data, builds
  accas in the band, and compares against random accas of the same size.

## What the sanity checks show (synthetic data only)

- Pure RNG league, 60 weeks: the best-looking pattern had +39% ROI in training
  and +1% on the holdout. None reached `STRONG` across 6 seeds.
- Same league with an edge planted on 5 teams: `team_bias_*_underrated` is found
  and holds on the holdout (+30% ROI).

## Limits you should keep in mind

- **Accas cannot validate anything.** At odds ~30 you need ~18,500 accas to
  confirm a +10% ROI. 50 gameweeks gives under 100. Validate at leg level
  (`mine`); the acca is only a payoff shape. Legs' margins compound too:
  a 6% margin per leg costs roughly a third of the stake over 6 legs.
- 50 gameweeks x 10 matches = 500 matches. Most patterns fire on a few dozen.
  Expect "no evidence" and treat it as the result.
- `forecast` signals beyond the first upcoming week use results only up to the
  last settled week.
- Past performance of a fitted pattern is not a guarantee. A provider can change its engine.

## Next steps toward a shared tool

Data collection (CSV export or an ingest adapter), a small web front-end,
bankroll / stake-sizing guidance, and a drift monitor that re-tests live patterns each week.
