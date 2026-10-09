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
`ledger.py` ledger · `patterns.py`/`backtest.py` older hypothesis miner ·
`tools/record_feed.py` feed recorder · `docs/feed-discovery.md`.

## Roadmap (from the v2 brief)
Done here: odds maths, slices, shrinkage, walk-forward, FDR, grading, golden
tests, sheets, ledger, recorder. Next: record the real feed and write
`docs/feed-schema.md`; a parser from recordings to CSV; then the always-on
collector, database, web app, booking codes and assistant.
