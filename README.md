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
only once 2,000 settled matches with odds exist **and**, on the most recent 30%
of matches (which it did not train on, at least 500 rows), it beats both the
results model and the market price itself. At 2,774 matches the blend beat the
model in 33 of 44 markets but the market in only 11, by under 0.004 in log loss,
mostly on about 190 rows and by leaning away from the model, so beating the
model alone no longer switches it on. The app and
`likely` pick this up automatically, label blended estimates, and the Record
page's Accuracy table shows the held-out comparison for every market.

Until then the estimate is **guarded**: 0.95·logit(market chance) + 0.05·logit(model),
with a 90% range that spans the market chance and the model's own range. On
2,774 settled matches with odds (76,579 selections, each model fitted only on
earlier days) mean log loss was 0.49694 at 85/15, 0.49681 at 95/5 and 0.49679 on
the market alone; 95/5 and the market alone beat 85/15 in both halves of the
data. The market price is the best estimate we have; the model now mostly
widens the range where it disagrees. With the guard a pick reaches Lean only
once a proven blend says so.

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

## Our picks

**Cooked slips** come first: each time a round is published, Vig cooks named
slips from it (Steady, Double up, Fiver, Tenner, Long shot, Hundred,
Thousand, Goal rush, Tight games, Bold, Draw trio/four), books each one and shows the code, ready to open in SportyBet
or tweak in the editor. A slip is only cooked when enough legs clear its
confidence bar, so the mix changes with the round. Every cooked code is logged
once (account "vig") and scored on Record by style. Long shot, Hundred and
Thousand are the likeliest slips near 20, 100 and 1,000 odds (up to 50 legs);
every leg pays the bookmaker's cut, so they land rarely.

**Steady** and **Tight games** use under lines only. On 6,898 matches (9 to 13
Oct) unders priced at 85% or more landed 90.7% against 89.8% priced (19,588
selections), the only family of markets to pass the false-discovery check;
other markets at that level landed as priced. Tight games keeps the unders that
landed above their price at 55 to 85% (home team under 1.5, first half under
1.5, under 2.5) and leaves out away team under 1.5 and both teams not to score,
which landed below it. Both still pay back a little less than the stake on
average.

Slips are built from the **best bet per match**, ranked by the bookmaker's
de-vigged chance rather than Vig's estimate: where the two disagree, results
have followed the market, and the model leans the same way across many matches
(under 3.5 about 1.4 points above the market, home wins 2 below), which made
every slip lean on under 3.5. No market may fill more than 40% of a slip, so a
match whose top market is already used offers its next one. Our picks opens on
the cooked slips; **Build your own** is its own tab, starting with Best per
match (5 to 50 legs).

**Markets** cover 1X2, double chance (home or draw, home or away, draw or
away), total goals and first-half lines, both teams to score, and each team's
own goals (home or away team over/under 0.5 to 3.5). On SportyBet's own
probabilities double chance pays back about ₦96.4 per ₦100 and team goals
about ₦96 at the 0.5 and 1.5 lines, against ₦96.9 on 1X2: they land often but
are not cheaper. Double chance's market chance is the sum of the two de-vigged
1X2 outcomes it covers. Slips take up to 50 legs, as SportyBet does, and the
slip shows what comes back on average by the bookmaker's own chances.

Below them, four sets to build your own, each from what the data has shown, ready to book or edit
(graded Avoid excluded):

- **Safe ~90%**: per published match, the best-paying selection with an
  estimate of at least 88% (85, 90 and 93 on the page).
- **Target odds** (2, 5, 10 or 20): the likeliest slip near the total, from
  legs priced 1.25 to 2.2 with Medium or High confidence. Backing every
  selection, short prices have lost little and long shots a lot, so several
  short legs keep more value than one long shot.
- **Bigger odds, High confidence**: legs at 1.8 or more where market and model agree.
- **Draws (flex)**: the likeliest draws, with the chance that at least k of n
  land for SportyBet's Flex option.

Safe ~90%: `vigs ourpicks` logs the same list hourly in shadow mode and the Record
page scores it. Checked on the first 762 settled matches with odds before
launch: at the 88% bar, 701 of 762 landed (92.0%) against 90.9% estimated.
They pay less than their chance once the bookmaker's margin is taken, and a
long accumulator of them still lands rarely (20 legs at 90% each: about 12%).

## What the data says

`vigs export-insights` (hourly, `insights.json`) publishes model-free facts for
the Record page: the margin by market, what backing every selection returned by
odds band, and league profiles. Codes booked in the app are copied to the
ledger (`vigs ledger import-codes`) with the time they were booked; legs that
had kicked off by then are not scored. The Record page scores them as codes and
leg by leg.

## Sharing

Every code has **Share**: a card image (square for posts and chats, 9:16 for
statuses and stories, `/api/share/<code>`) and text formatted for WhatsApp
(message with bold code, or status), X (post under 280 characters, or DM),
Instagram (story image plus caption) or plain text. Cards show prematch odds,
results so far and Vig's chance when Vig knew every leg before kickoff, with
"18+ · estimates, not promises". No link back to Vig yet.

## Beta

**Feedback** (top bar, and Account → Ideas and bugs): anyone signed in can post
an idea or a bug and back others; admins (`ADMIN_ACCOUNTS`, default `me`) set a
status (New, Planned, Done, Not now) and reply, and get a push for each new post.
**Invites** (Account, admins only): add a friend's Google address and an
account name; they sign in with Google without a change to `GOOGLE_ACCOUNTS` or
a redeploy, and get their own codes, record, alerts and settings. Removing an
invite stops new sign-ins; changing `AUTH_SECRET` ends sessions already open.

**Load on SportyBet.** The collector makes about one request a minute (odds,
live list, results). The app reads the live list at most every 8 seconds per
server instance, and a code's share page only when it loads or a leg should be
over; the tick checks for a new round at most once a minute and re-reads
accounts every two minutes. That is less than one person browsing SportyBet,
and the collector logs show no refusals.

## Accounts

Signed-in accounts get an **Account** page (avatar, top right): display name,
usual stake (slips and share text show what it returns), the page the
home-screen app opens on, and saved filters (save any Tonight filters by name
and apply them in one tap). Every code the account books, opens, copies or
tracks is logged once to the ledger; legs Vig can price before kickoff carry
its estimate, and Record breaks the account's legs down by market.

**Google sign-in** (recommended): create an OAuth client (Google Cloud Console →
APIs & Services → Credentials → OAuth client ID → Web application) with the
redirect URI `https://<your app>/api/auth/google/callback`, then set in Vercel
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` (a long random
string) and `GOOGLE_ACCOUNTS="you@gmail.com=me,friend@gmail.com=ada"`. Only
listed addresses get in, each as the named account (map yours to `me` to keep
what that account already has). Password sign-in keeps working alongside.

Signing in picks the account. `ACCOUNTS="name:password,name2:password2"` in
Vercel lists them (passwords must differ: the form asks only for the
password); without it, `APP_PASSWORD` is one account called "me". With the
store connected, an account's booked codes, last filters, Chance/Full view and
theme sync across every device signed in to it; the first sync merges what
each device already had. Push tips follow the account's latest filters.

## First run and Settings

A new account starts with a short tour: Simple or Rich view, a usual stake,
five real screens of the app with the part that matters highlighted, and
notifications. It can be skipped and replayed from Settings.

**Simple** (the default) shows the chance a leg or slip lands, the odds and
what it pays. **Rich** adds break-even, the bookmaker's own chance, the 90%
range, edge and grade. **Settings** (the avatar) holds the view, name, usual
stake, start page, theme, this device's notifications, saved filters, help and,
for admins, invites and a setup check. The Codes tab shows how many codes are
open, and reopening the app refreshes everything without a pull.

**Your habits** (Record, Your codes) breaks each account's settled codes down
by slip length, the Lagos time they were booked and where they came from, each
against how many SportyBet's own prices said should land and what came back per
₦100 staked, with a few plain notes: which slip lengths have done best and
worst, long slips that never landed, markets well above or below their price
(30 or more legs), and the result at the usual stake. Notes need at least 8
settled codes.

## Your codes and notifications

**Codes** has two tabs, like SportyBet: **Open** (in play, 10 at a time) and
**History** (landed or lost, removable; removing hides a code, the record keeps
it). Tap a card for its legs, with each leg's
prematch price. SportyBet's share endpoint returns the prematch price only
until kickoff and a different in-play price afterwards, so Vig keeps the
prematch prices from booking time or from before kickoff, and shows none
rather than a wrong one, and any code typed into "Track a code". One read of
SportyBet's share endpoint gives each leg's status and final score.

While a leg plays, Codes reads SportyBet's live feed every 10 seconds: each
leg's minute and score, and the **chance to land**: each open leg's chance from
SportyBet's own live probability (1 or 0 once the score decides it, so an over
that has gone over shows as landed at once), multiplied across the code, with
an arrow for the last move and a line of how it has swung. Legs not yet started
use the market chance. A leg that has ended or is already beaten is read again
from the share endpoint straight away. The chance to land sits large on the
ticket and rolls to each new value; live minutes pulse, scores are blue while a
leg is on course and red while it is off, and a goal flashes the score.

**Hedge** appears when one leg is left. It prices the selection that wins
exactly when that leg loses (double chance for home/draw/away, the other side
of an over/under or both-teams-score line) at SportyBet's current price, and
shows three choices for the stake and payout entered: keep it (the chance and
the average result), cover both ways for the same result (stake = payout ÷
price), or get the stake back if the leg fails. It says what covering gives up
on average by SportyBet's own chance: the margin, paid a second time. It can
book the hedge as a code; it never places a bet, and the price moves every few
seconds.

**Alerts** sends web push notifications to a phone: when a code lands or
loses (as soon as the score beats a leg, without waiting for the match to end),
a goal that moves a code's chance by 15 points or more, when one leg is left
(with its chance, to ride or hedge), a tip slip at chosen Lagos times built
with the account's last Tonight filters, and an Our picks set on a schedule
(every 1 to 12 hours between chosen hours). Each open code can be set to
**Every goal** (every goal in any of its legs, plus the result), **Key
moments** (the device's usual alerts) or **Off**, and the bell on any leg
follows that match on its own: kick-off, every goal, half time and full time.
On iPhone, add Vig to the Home
Screen first. The app also offers a reload, in a toast, when a new version is
deployed or a new round is published. Setup, once:

1. Vercel → the project → Storage → connect a Redis store (Upstash for Redis or
   Redis, free plans) to the Production environment. Either its REST pair
   (`KV_REST_API_URL` and `KV_REST_API_TOKEN`, any prefix, or
   `UPSTASH_REDIS_REST_*`) or a `redis://` / `rediss://` `REDIS_URL` works. The
   Alerts page's setup check shows what it found.
2. Vercel → Settings → Environment Variables: `PUSH_TICK_SECRET`, any long
   random string. Redeploy.
3. GitHub → Settings → Secrets and variables → Actions: secret
   `PUSH_TICK_SECRET` (the same string) and variable `PUSH_TICK_URL`
   (`https://<your app>/api/push/tick`).
4. Open Alerts on the phone, turn notifications on, and send a test.

Every open code on a signed-in account is watched, however it was booked
(built, cooked, copied, opened or tracked). The collector calls the tick about
every 20 seconds while a watched leg is in play and every 2 minutes otherwise
(the tick tells it which). GitHub starts the collector every 30 minutes (each
run waits behind the one in progress, so runs chain end to end even when GitHub
starts them late). Only one tick runs at a time; after a gap of more than 4
minutes the first tick catches up quietly (it records what changed without
sending stale news), and a result is never sent for a code whose last match
kicked off more than 45 minutes earlier. Settled codes still settle in the app on the
next refresh. For extra safety an outside scheduler (cron-job.org, free) can
POST to the tick URL every minute with `Authorization: Bearer <PUSH_TICK_SECRET>`.
Push signing keys
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
