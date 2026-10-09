# CLAUDE.md

Vig: history-backed selections for SportyBet virtual football. Python 3.10+,
stdlib only in `vigs/` (Playwright only in `tools/record_feed.py`).

## The idea
Odds say what the bookmaker thinks and what you're paid; history says what
happened. A pick is only good if history beats its **break-even** (`1/odds`) by
more than luck explains, on data the model never saw. Definitions (break-even,
market chance, history rate, Vig estimate, edge) and grades (Solid, Lean, Rough,
Avoid) are in README.md and `vigs/grading.py`; keep code and copy consistent with them.

## Honesty rules (non-negotiable)
1. Every pick shows odds, break-even, market chance, history rate with n, Vig
   estimate with 90% interval, edge, grade, and why.
2. Picks are logged to the append-only hash-chained ledger before kickoff and
   settled by appending. Never edit or delete ledger records.
3. Banned in product text: the words listed in `tests/test_evidence.py::BannedWords`.
   The test scans `vigs/` and README.md.
4. Grades are earned: Solid needs ≥ 300 samples, walk-forward validation, the
   false-discovery check and ≥ 30 days of data. Never lower the bar to fill a sheet;
   say "Nothing clears the … bar" instead.
5. Shadow mode by default: picks are logged with zero stake.
6. Never place bets, never store SportyBet credentials. Personal tool; public or
   paid release needs legal review (Nigerian gaming rules, SportyBet terms).
7. No mocked or made-up results presented as real data. `synth` output is test-only.

## Data
- Source: SportyBet's public factsCenter API for vFootball (`docs/feed-schema.md`).
  Results back a year, no odds; odds only for upcoming rounds, captured live.
- `vigs/sportybet.py` fetches (1.2 s between requests, browser User-Agent) and
  `build` joins results to the last odds snapshot taken **before** kickoff.
- The `data` branch is written only by `.github/workflows/collect.yml`. Never
  push to it or rewrite it by hand. `data/` is git-ignored on code branches.

## Web app
- `web/` is Next.js 16 (read `web/node_modules/next/dist/docs` before changing
  framework code: `proxy.ts` replaces middleware; `searchParams` and `cookies()` are async).
- `web/lib` ports the model maths from `vigs/model.py`; `web/tests` pins it to
  Python output. Change both together.
- It reads `model.json` and `record.json` from the `data` branch and odds live
  from SportyBet; it never places bets. Record maths stays in `vigs/record.py`. Booking codes are created with the `OperId: 2` header.

## Engineering rules
- All maths in `vigs/odds.py`, `vigs/stats.py`, `vigs/grading.py`; CLI only formats.
- Point-in-time: anything describing a match uses earlier rounds only (tests enforce it).
- Slices always include the odds bucket. The FDR family is always every market.
- Times are UTC in data; Lagos (UTC+1) only for display and the hour context.
- Every pick stores `slice_key` and `stats_version` so its grade can be recomputed.
- Run `python -m unittest discover -s tests -q` before committing.

## Layout
`vigs/data.py` CSV + markets + synthetic generator · `odds.py` odds maths ·
`stats.py` tests, Beta functions · `grading.py` shrinkage + grades ·
`evidence.py` contexts, slices, walk-forward, FDR · `sheet.py` sheet builder ·
`ledger.py` ledger · `sportybet.py` API client, collector, build ·
`study.py` results-only memory tests · `patterns.py`/`backtest.py` older
hypothesis miner · `tools/collect.sh` collector loop · `tools/record_feed.py`
browser recorder · `docs/feed-schema.md`.

## Roadmap (from the v2 brief)
Done here: odds maths, slices, shrinkage, walk-forward, FDR, grading, golden
tests, sheets, ledger, recorder, API client, always-on collector, results study.
Next: weeks of collected odds, then evidence on real data; then database, web
app, booking codes and assistant.
