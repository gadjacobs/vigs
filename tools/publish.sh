# Sourced by tools/collect.sh before every hourly save (re-read each time, so
# new steps take effect without restarting the collector). Uses $DATA.
# Model for the web app, then log the coming hour's picks (shadow mode) and
# settle earlier ones, so every list the method produces is scored.
# Results first, so restarts or outages never leave gaps (the archive goes back a year).
python -m vigs fetch results --data "$DATA" --days 0.25 > /dev/null || true
python -m vigs export-model --data "$DATA" --out "$DATA/model.json" || true
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
fi
python -m vigs ledger settle --ledger "$DATA/ledger.jsonl" --results "$DATA/results.csv" || true
python -m vigs export-insights --data "$DATA" --out "$DATA/insights.json" || true
python -m vigs export-record --ledger "$DATA/ledger.jsonl" --out "$DATA/record.json" || true
