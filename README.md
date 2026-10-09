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
| market chance | implied probability with the margin removed (Shin for live odds: it scored better than proportional on settled matches; the evidence tools default to proportional) |
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

## Web app (`web/`)

Next.js app for live picks: choose one or more markets, a window and a per-leg
odds range; build either a number of picks or a slip to a total price (any number, e.g.
20.2, within ±5, 10 or 20%: the most likely combination in that band, with an
optional cap on games); edit
the slip (remove, smart switch to a similar-priced alternative, add); then turn
it into a SportyBet booking code and open it in the SportyBet app (falls back
to the website). Theme: Auto, Day or Floodlit, remembered per device. It fetches odds live
from SportyBet on each load and reads `model.json`, which the collector
publishes hourly to the `data` branch. No database.

Deploy on Vercel:
1. vercel.com → Add New → Project → import `gadjacobs/vigs`.
2. Root Directory: `web` (framework detected as Next.js).
3. Environment variable `APP_PASSWORD`: anything you choose. Every page sits
   behind it, with an 18+ confirmation. Optional: `MODEL_URL` to read the model elsewhere.
4. Deploy. Pushes to the branch redeploy automatically.

Local: `cd web && npm install && MODEL_PATH=../data/model.json npm run dev`
(`npm test` checks the TypeScript model against the Python one).

Grades in the app top out at Lean until odds history can validate an edge.
The collector also logs the coming hour's top picks per market to
`ledger.jsonl` on the `data` branch, settles them, and publishes the scorecard
as `record.json` (`python -m vigs export-record`). The **Record** page shows it:
ROI and hit rate against expectation by grade and market, a profit curve,
calibration, and recent picks. Intervals are hidden below 30 settled picks.

## Blend of market price and model

The results model ignores what the odds know. `vigs/blend.py` learns, per
market, P(win) = sigmoid(a + b1·logit(market chance) + b2·logit(model)) from
settled matches with captured pre-kickoff odds. The model input is
point-in-time (fitted on results before each match's day). The collector runs
`export-blend` hourly and publishes `blend.json`. A market's blend switches on
only once 2,000 settled matches with odds exist **and** it beats the results
model on the most recent 30% of matches, which it did not train on. The app and
`likely` pick this up automatically, label blended estimates, and the Record
page's Accuracy table shows the held-out comparison for every market.

Until then the estimate is **guarded**: 0.7·logit(market chance) + 0.3·logit(model),
with a 90% range that spans the market chance and the model's own range. On the
first 269 settled matches with odds the market price beat the results model on
log loss in all 10 markets checked, and Lean picks landed 28 of 52 against 35.4
expected, so the raw model was overconfident where it disagreed with the market.
With the guard a pick reaches Lean only once a proven blend says so.

## Chance view

The filters can also require a confidence level (Medium or better, High only)
and a lowest chance per pick (50% to 85%).

The app's "Chance" view shows each pick as a whole-percent chance ("68% chance,
about 7 in 10"), what the odds need to break even, and a confidence rating from
the width of the 90% range: High (within 5 points and tight on the odds scale),
Low (wider than 10 points, or loose on the odds scale), Medium otherwise. A wide
range means the market price and the model disagree. A slip shows the chance
all legs land and takes its weakest leg's rating. Every figure from the full
view stays on the card. "Full numbers" shows the original layout.

## Accounts

Signing in picks the account. `ACCOUNTS="name:password,name2:password2"` in
Vercel lists them (passwords must differ: the form asks only for the
password); without it, `APP_PASSWORD` is one account called "me". With the
store connected, an account's booked codes, last filters, Chance/Full view and
theme sync across every device signed in to it; the first sync merges what
each device already had. Push tips follow the account's latest filters.

## Your codes and notifications

**Your codes** (Tonight page) lists codes booked on this device for six hours
after their last kickoff, and any code typed into "Track a code". One read of
SportyBet's share endpoint gives each leg's status and score; the panel
refreshes every minute.

**Alerts** sends web push notifications to a phone: when a booked code lands
or loses (the first lost leg ends it), and a tip slip at chosen Lagos times,
built with that device's last Tonight filters. On iPhone, add Vig to the Home
Screen first. Setup, once:

1. Vercel → the project → Storage → connect **Upstash for Redis** (free plan)
   to the Production environment. It adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` (a custom prefix, `UPSTASH_REDIS_REST_*` or an Upstash
   `REDIS_URL` also work). The Alerts page's setup check shows what it found.
2. Vercel → Settings → Environment Variables: `PUSH_TICK_SECRET`, any long
   random string. Redeploy.
3. GitHub → Settings → Secrets and variables → Actions: secret
   `PUSH_TICK_SECRET` (the same string) and variable `PUSH_TICK_URL`
   (`https://<your app>/api/push/tick`).
4. Open Alerts on the phone, turn notifications on, and send a test.

The collector calls the tick every 4 minutes while it runs. Push signing keys
are made on first use and kept in the store (or set `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY`). The store holds only push subscriptions, tip times,
filters and watched codes; no SportyBet details.

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
