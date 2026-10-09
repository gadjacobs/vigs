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
