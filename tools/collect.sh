#!/usr/bin/env bash
# Collect SportyBet vFootball odds and results into a git checkout of the
# `data` branch, committing after every chunk so a killed job loses at most one.
# Usage: tools/collect.sh DATA_DIR [CHUNKS] [MINUTES_PER_CHUNK]
set -u
DATA=$(cd "$1" && pwd)
CHUNKS=${2:-6}
MINUTES=${3:-55}
cd "$(dirname "$0")/.."

save() {
  (
    cd "$DATA" || exit 1
    git add -A
    git diff --cached --quiet && exit 0
    git commit -qm "data: $(date -u +%Y-%m-%dT%H:%MZ)"
    git push -q origin HEAD:data
  ) || echo "save failed (will retry after the next chunk)"
}

if [ ! -f "$DATA/results.csv" ]; then
  echo "first run: backfilling 30 days of results"
  python -m vigs fetch results --data "$DATA" --days 30 --delay 1.5
  save
fi
publish() {
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
  python -m vigs ledger settle --ledger "$DATA/ledger.jsonl" --results "$DATA/results.csv" || true
  python -m vigs export-record --ledger "$DATA/ledger.jsonl" --out "$DATA/record.json" || true
}

# Push notifications: every 4 minutes ask the web app to settle watched codes
# and send due tips. Needs PUSH_TICK_URL and PUSH_TICK_SECRET; skipped otherwise.
if [ -n "${PUSH_TICK_URL:-}" ] && [ -n "${PUSH_TICK_SECRET:-}" ]; then
  (
    while true; do
      curl -sS -m 60 -X POST -H "Authorization: Bearer $PUSH_TICK_SECRET" "$PUSH_TICK_URL" > /dev/null \
        || echo "push tick failed"
      sleep 240
    done
  ) &
  TICKER=$!
  trap 'kill $TICKER 2>/dev/null' EXIT
fi

publish
save
for i in $(seq 1 "$CHUNKS"); do
  echo "chunk $i/$CHUNKS"
  python -u -m vigs fetch watch --data "$DATA" --minutes "$MINUTES" --interval 240
  publish
  save
done
