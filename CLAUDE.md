# CLAUDE.md

Vig: history-backed selections for SportyBet virtual football. Python 3.10+,
stdlib only in `vigs/` (Playwright only in `tools/record_feed.py` and `tools/tour_shots.py`).

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
   settled by appending. Never edit or delete ledger records. Past 40 MB `ledger seal`
   renames the file unchanged to `ledger.NNN.jsonl`; the chain continues across segments.
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
  Results back a year, no odds; odds only for upcoming rounds, captured live. `results.csv`
  holds results from 9 Sep 2026; `fetch backfill` (run in the background by `publish.sh`)
  extends `archive/results-YYYY-MM.csv` back a year. Each snapshot also stores `extra`
  prices (FH 1X2/DC/handicap, handicap, correct score, 1X2&GG, team goals, odd/even) from
  16 Oct 2026; nothing prices picks from them yet.
- `vigs/sportybet.py` fetches (1.2 s between requests, browser User-Agent) and
  `build` joins results to the last odds snapshot taken **before** kickoff.
- The `data` branch is written only by `.github/workflows/collect.yml`. Never
  push to it or rewrite it by hand. `data/` is git-ignored on code branches.

## Web app
- `web/` is Next.js 16 (read `web/node_modules/next/dist/docs` before changing
  framework code: `proxy.ts` replaces middleware; `searchParams` and `cookies()` are async).
- `web/lib` ports the model maths from `vigs/model.py`; `web/tests` pins it to
  Python output. Change both together.
- Blend (`vigs/blend.py`, `web/lib/blend.ts`): market price + model, per market,
  on only after 2,000 settled matches with odds and a held-out win (≥ 500 rows) over both the
  model and the market price, by more than luck (per-match gain, BH 10% across markets). Otherwise estimates use `guarded` (95/5 toward the market, range
  spanning both). Never train on a match with a model that saw its day's results.
- It reads `model.json`, `blend.json` and `record.json` from the `data` branch and odds live
  from SportyBet; it never places bets. Record maths stays in `vigs/record.py`. Booking codes are created with the `OperId: 2` header.
- Accounts (`web/lib/auth.ts`, `profile.ts`): `ACCOUNTS` or `APP_PASSWORD`; a profile
  per account in the store syncs codes, filters, view and theme. Never store SportyBet details.
- Cooked slips (`web/lib/slates.ts`, `kitchen.ts`): cooked and booked once per published
  round (by the tick or the first viewer), stored as `slates`; each code logged once as
  user "vig" (Most likely / Most confident templates too, as `template:top`/`template:trusted`). Steady and Tight
  games pick markets from `lean` (`web/lib/lean.ts`; seven chance levels; only markets whose lean `held` on later days), falling back to fixed under lists. Never show share-endpoint odds after kickoff (they are in-play prices).
- Google sign-in (`/api/auth/google`): `GOOGLE_ACCOUNTS` allowlist maps emails to accounts.
- Our picks (`web/lib/ourpicks.ts`, `/picks`): templates top/trusted (Most likely / Most confident, leaning on
  `insights.json` `lean`, per-market landed vs priced by chance level), sets safe/odds/bold/draws; `vigs ourpicks`
  logs the safe set hourly. Booked codes go to the store's `codelog` with the server's
  clock and are copied into the ledger by `vigs ledger import-codes`; legs that had
  kicked off when booked are never scored. `vigs export-insights` feeds Record.
- Live (`web/lib/live.ts`, `hedge.ts`, `app/live-actions.ts`): Codes polls SportyBet's live feed
  every 15 s while a leg plays; chance to land = SportyBet's live probability per open leg
  (1/0 once the score decides it); legs to play use the upcoming list, else the match's own prematch
  feed (the list drops a round ~9 min before kickoff). The tick saves each round's prematch prices
  (`lib/prematch.ts`, `pre:{kickoff}`, 2 days) so codes first opened after kickoff still get prematch odds.
  Codes cards: Full or Compact (per device), legs in kickoff order. Flex odds follow SportyBet's own rule
  (`lib/flex.ts` `flexQuote`: payback 0.65 for virtual games ÷ chance at least k land); Our picks
  "Flex big odds" grows a slip to a Flex odds target. SportyBet's multi-bet bonus (`lib/bonus.ts`
  `multiBonus`: legs ≥ 1.20 qualify, ratio = weighted leg payback ÷ slip payback − 1 within a range per
  leg count, straight slips only) shows on slips, cooked slips and codes; template floor 1.20. Our picks "Bonus slip": likeliest
  leg per match at 1.20-1.30 (no double chance), 10-35 legs; its return uses insights `bonus_legs` (landed/priced). First half vs usual (`lib/fhusual.ts`,
  insights `fh_usual`): marker on FH legs and the Tonight filter `fh=likelier`. Hot rounds (`lib/hotround.ts`, `hotalert.ts`):
  when a league's round scores ≥ 0.2 goals a match over its saved prices (`pre:`/`prefx:`, results from `eventResultList`),
  overs in its next round get +1.2% (held out, docs/research-2026-10-31.md); the tick books an overs slip (legs ≥ 1.20) and
  alerts subs with `hot` on (default). The multi-bet bonus is confirmed on vFootball: the keep meter leads with it. Hedge only does arithmetic and books a code; never bets.
  The tick (`lib/ticker.ts` `runTickOnce`) runs inside the collector in GitHub Actions (`web/tools/tick.mts`, needs a
  `REDIS_URL` secret) to keep it off the Vercel plan's CPU; `/api/push/tick` is the fallback on the same schedule.
  It watches every open code on subscribed accounts and returns `next` (20 s live, 120 s idle).
  One tick at a time (`tick:running`); after a gap > 4 min it catches up without sending, and no
  result is sent > 45 min after a code's last kickoff. Collector cron is every 30 min (runs chain).
- Markets include double chance (DC1X/DC12/DCX2: market chance = sum of the two de-vigged 1X2
  outcomes) and team goals (H_/A_ over/under 0.5–3.5); Python and web settle and price them the same.
  Slips take up to 50 legs (`MAX_LEGS`). Cooked slips and Best per match rank legs by market
  chance (`bestPerMatch`, max 40% per market), not the model. Codes with non-vFootball legs are
  shown as such and never tracked, alerted or logged. Per-code alert modes (`codealert:`) and followed matches
  (`fixture:`) live in the store; a code's result is sent once (`done:`).
- Settings (`/account`) and the first-run tour (`/onboarding`, `web/lib/tour.ts`): `prefs.onboarded`
  (or cookie `vig_onb`) ends the redirect from `/` and `/start`. Tour screens are real captures
  made by `tools/tour_shots.py` (Playwright) with their spots in `web/lib/tour-spots.json`;
  re-run it when those screens change. View is Simple (chance first) unless the account picks Rich.
- Beta (`web/lib/beta.ts`, `/feedback`, Account): ideas/bugs with votes; admins (`ADMIN_ACCOUNTS`,
  default `me`) answer and invite testers by Google address (stored `invites`, `.i.` sessions).
- Push (`web/lib/push.ts`, `store.ts`, `/alerts`): Upstash Redis holds subscriptions,
  tip times, watched codes and profiles only; `/api/push/tick` is called by the collector with
  `PUSH_TICK_SECRET`. Slip alerts (`lib/watches.ts`, `profile.watches`, run by the tick): saved
  filters/templates meeting conditions, per account every 10 min, each at most every 2 h. Admin (`/admin`, `lib/activity.ts`, `lib/seen.ts`): per-account activity from
  the store and record; results at the usual stake are estimates. Live odds use Shin de-vig (`vigs.odds.LIVE_DEVIG`, `fairProbs`).

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
