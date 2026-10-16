# Sourced by tools/collect.sh before every hourly save (re-read each time, so
# new steps take effect without restarting the collector). Uses $DATA.
# Model for the web app, then log the coming hour's picks (shadow mode) and
# settle earlier ones, so every list the method produces is scored.
# Results come from the watcher running alongside (every 4 minutes, 2 hours back),
# and collect.sh fills the last 6 hours when a job starts.
# Results history: extend the archive (archive/results-YYYY-MM.csv) back a year, in
# the background at one request every 2 s, resuming from the oldest result held.
# One at a time; the regular saves commit whatever it has written.
if ! { [ -f /tmp/vigs-backfill.pid ] && kill -0 "$(cat /tmp/vigs-backfill.pid)" 2>/dev/null; }; then
  nohup python -m vigs fetch backfill --data "$DATA" --days 365 --delay 2.0 >> /tmp/vigs-backfill.log 2>&1 &
  echo $! > /tmp/vigs-backfill.pid
fi
tail -n 1 /tmp/vigs-backfill.log 2>/dev/null | sed 's/^/backfill: /' || true
python -m vigs export-model --data "$DATA" --out "$DATA/model.json" || true
# Past 40 MB the ledger file is sealed, unchanged, as ledger.NNN.jsonl and the
# hash chain carries on in a fresh ledger.jsonl (git hosts refuse files over 100 MB).
python -m vigs ledger seal --ledger "$DATA/ledger.jsonl" || true
python -m vigs export-blend --data "$DATA" --out "$DATA/blend.json" || true
for m in FH_O05 BY O15; do
  python -m vigs likely --market "$m" --hours 1 --count 20 --data "$DATA" \
    --ledger "$DATA/ledger.jsonl" --no-refresh > /dev/null || true
done
python -m vigs ourpicks --hours 1 --data "$DATA" --ledger "$DATA/ledger.jsonl" > /dev/null || true
if [ -n "${PUSH_TICK_URL:-}" ] && [ -n "${PUSH_TICK_SECRET:-}" ]; then
  # Codes booked in the app (yours and the cooked slips), so Record can score them.
  python -m vigs ledger import-codes --ledger "$DATA/ledger.jsonl" \
    --url "${PUSH_TICK_URL%/api/push/tick}/api/codes/log" || true
  # The notification tick's health, for this log: when it last ran and its last error.
  echo "push tick status: $(curl -sS -m 30 -H "Authorization: Bearer $PUSH_TICK_SECRET" "$PUSH_TICK_URL" | head -c 700 || true)"
fi
python -m vigs ledger settle --ledger "$DATA/ledger.jsonl" --results "$DATA/results.csv" || true
python -m vigs export-insights --data "$DATA" --out "$DATA/insights.json" || true
python -m vigs export-record --ledger "$DATA/ledger.jsonl" --out "$DATA/record.json" || true
