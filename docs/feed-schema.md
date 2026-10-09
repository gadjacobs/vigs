# SportyBet vFootball: data source

Found by reading SportyBet's own web app (October 2026). These are the public
JSON endpoints its site calls; nothing here needs a login. Personal use only:
keep requests slow (the client waits 1.2 s between calls).

## Product

SportyBet runs several virtual products. This tool reads **vFootball**
(`sr:sport:202120001`, page `/ng/sport/vFootball`), which lives inside
SportyBet's normal sports API. Golden Virtuals, Scheduled Virtuals and Instant
Virtuals are separate products with different feeds; none are covered here.
The supplier behind vFootball is not named anywhere in the API.

| league (category) | teams | round every |
|---|---|---|
| England | 20 | 38 min |
| Spain | 20 | 38 min |
| Italy | 20 | 38 min |
| Germany | 18 | 42 min |
| France | 18 | 42 min |

About 1,750 matches a day across the five leagues, 10 or 9 per round. Each match
plays out over about 30 minutes of real time; results appear in the archive
roughly 50 minutes after kickoff. Rounds
are staggered across leagues.

## Endpoints

Base: `https://www.sportybet.com/api/ng/factsCenter/`. A browser-like
`User-Agent` is required (the default curl agent gets 403). Every response is
`{"bizCode": 10000, "message": "0#0", "data": ...}`; other codes are errors
(19000 "Invalid" for a bad parameter, including `pageSize` above 100).

**Results**: `eventResultList?sportId=sr:sport:202120001&startTime=<ms>&endTime=<ms>&pageNum=1&pageSize=100`
- `data.totalNum`, `data.tournaments[].events[]`
- per event: `eventId` (`sr:match:...`), `estimateStartTime` (ms), `matchStatus` (`End`),
  `homeTeamName`, `awayTeamName`, `setScore` (`"2:1"` full time),
  `regularTimeScore` / `gameScore` (`["1:0", "1:1"]`: first half, second half),
  `sport.category.name` (league)
- history reaches back at least 365 days at the same daily volume
- no odds or markets

**Upcoming with odds**: `pcUpcomingEvents?sportId=sr:sport:202120001&marketId=1,18,68,29&pageSize=100&pageNum=1&option=1`
- only rounds not yet started: usually the next round per league, sometimes two to four for Germany and France
- per event: `markets[]` with `id`, `specifier` (e.g. `total=1.5`), `status`, and
  `outcomes[]` with `desc`, `odds` (string), `isActive`
- market ids: `1` 1X2 · `18` total goals, lines 0.5 to 9.5 · `68` first-half total, 0.5 to 4.5 ·
  `29` both teams score (`Yes`/`No`) · `19`/`20` home/away team totals · `60` first-half 1X2.
  45 markets per match in all.
- odds for a match did not change between snapshots taken minutes apart

**Single event**: `event?eventId=...&productId=3` returns no markets once the match is over.

## Consequences

- Results can be backfilled for months in minutes (100 per request).
- Odds cannot be backfilled. They must be captured before each round kicks
  off and joined to the result by `eventId`. `vigs fetch watch` does this every
  4 minutes; `.github/workflows/collect.yml` runs it around the clock and
  commits to the `data` branch.
- The API has no round or season number. `week` in the built CSV is the kickoff
  minute, so the "stage of season" context is not available.

## Not yet known

- How long before kickoff each round's odds appear (the watcher's first
  snapshot per match bounds it).
- Whether odds for a pairing repeat across seasons. If they do, past results
  could be given odds; until shown, they are not.
