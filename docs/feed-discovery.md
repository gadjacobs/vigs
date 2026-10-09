# Feed discovery

SportyBet embeds the GoldenRace virtual client in an iframe. Fixtures, odds,
standings and results most likely arrive as WebSocket frames. Don't guess the
schema: record it, then write `docs/feed-schema.md` from the evidence.

## Record (on your own computer)

```
pip install playwright && playwright install chromium
python tools/record_feed.py --out feed.jsonl
```

Open virtual football, pick a league, and leave it running through several full
rounds in each league. Results pages and standings help. Stop with Ctrl+C. Then:

```
python tools/record_feed.py --summarize feed.jsonl
```

### Capture the results archive too (backfill instead of waiting)

While recording, also open SportyBet's **Results** page, choose virtual football,
and page back through every day and league it offers. That captures the
endpoint behind the results history, so a backfill script can pull past rounds
in minutes instead of waiting for them to be played. Results pages usually
carry scores but not pre-match odds, so live recording is still needed for
odds; check whether a pairing's odds repeat across a season (if they do, past
odds can be matched from recorded ones).

If another bookmaker runs the same virtual product, record it in a second
window for an hour and compare kickoff times and scores. Identical matches mean
a shared feed (no extra data); different matches mean an independent sample of
the same engine, which multiplies the data rate.

The recorder captures WebSocket frames from the page and its cross-site
iframes (tested against a local stand-in), plus JSON HTTP responses. It never
logs in or places bets.

## Questions `docs/feed-schema.md` must answer, with examples

- Message types; ids for leagues, seasons, rounds, events, markets, selections.
- How markets, lines (1.5, 2.5) and periods (full time, first half) are keyed.
- Are half-time scores and goal minutes present? If not, can first-half markets
  be settled from market-result frames?
- How far ahead rounds are published, and the round cadence per league.
- How seasons reset; what standings and form data exist.
- Odds snapshots: when do they change before kickoff, and which one is closing?

Once known, a small parser turns a recording into the CSV format in the README
(including `kickoff`, `ht_hg`, `ht_ag` and every line market), and `vigs` takes it from there.
