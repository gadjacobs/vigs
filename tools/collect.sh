#!/usr/bin/env bash
# Collect SportyBet vFootball odds and results into a git checkout of the
# `data` branch, committing after every chunk so a killed job loses at most one.
# Usage: tools/collect.sh DATA_DIR [CHUNKS] [MINUTES_PER_CHUNK]
set -u
# Run from a copy, so pulling new code mid-run never rewrites the script bash
# is reading. The code itself is updated before every hourly publish.
if [ -z "${VIG_RUNNING_COPY:-}" ]; then
  VIG_REPO=$(cd "$(dirname "$0")/.." && pwd)
  export VIG_REPO VIG_RUNNING_COPY=1
  copy=$(mktemp)
  cp "$0" "$copy"
  exec bash "$copy" "$@"
fi
DATA=$(cd "$1" && pwd)
CHUNKS=${2:-6}
MINUTES=${3:-55}
cd "$VIG_REPO"

update_code() {
  # Fast-forward to the latest code on this branch; publish steps live in
  # tools/publish.sh, re-read each time, so new steps start within the hour.
  git pull -q --ff-only 2>/dev/null || echo "code update skipped"
}

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
  update_code
  # shellcheck source=tools/publish.sh
  . tools/publish.sh
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
