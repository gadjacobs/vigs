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

echo "push tick: url $([ -n "${PUSH_TICK_URL:-}" ] && echo set || echo MISSING), secret $([ -n "${PUSH_TICK_SECRET:-}" ] && echo set || echo MISSING)"
# Push notifications: ask the web app to follow watched codes, settle them and
# send due tips. It answers with how soon to call again: about every 20 seconds
# while a watched leg is in play, every 2 minutes otherwise. Needs
# PUSH_TICK_URL and PUSH_TICK_SECRET; skipped otherwise.
if [ -n "${PUSH_TICK_URL:-}" ] && [ -n "${PUSH_TICK_SECRET:-}" ]; then
  (
    while true; do
      body=$(curl -sS -m 60 -w "\n%{http_code}" -X POST -H "Authorization: Bearer $PUSH_TICK_SECRET" "$PUSH_TICK_URL") \
        || body=000
      code=${body##*$'\n'}
      [ "$code" = 200 ] || echo "push tick: HTTP $code"
      next=$(printf '%s' "$body" | grep -o '"next":[0-9]*' | grep -o '[0-9]*$' || true)
      case "$next" in ''|*[!0-9]*) next=120 ;; esac
      [ "$next" -lt 15 ] && next=15
      [ "$next" -gt 300 ] && next=300
      sleep "$next"
    done
  ) &
  TICKER=$!
fi

# The watcher runs for the whole job in the background, so odds, live prices and
# results are captured every 4 minutes without pause. Publishing (model, picks,
# ledger, record) reads the whole ledger several times and now takes 15-30
# minutes; when it ran in between watch chunks, every round in that window went
# unpriced (39 hours of gaps over 9-13 Oct). If the watcher crashes it is
# started again.
TOTAL=$((CHUNKS * MINUTES))
END=$(( $(date +%s) + TOTAL * 60 ))
python -m vigs fetch results --data "$DATA" --days 0.25 > /dev/null || true
(
  while [ "$(date +%s)" -lt "$END" ]; do
    left=$(( (END - $(date +%s)) / 60 ))
    [ "$left" -lt 5 ] && break
    # A clean exit means the time is up; only a crash is restarted.
    python -u -m vigs fetch watch --data "$DATA" --minutes "$left" --interval 240 && break
    echo "watcher stopped; restarting"
    sleep 30
  done
) &
WATCHER=$!
trap 'kill $WATCHER ${TICKER:-} 2>/dev/null' EXIT

publish
save
while [ "$(date +%s)" -lt "$END" ]; do
  # Publish about once an hour while the watcher keeps collecting.
  wait_s=$(( MINUTES * 60 ))
  [ $(( $(date +%s) + wait_s )) -gt "$END" ] && wait_s=$(( END - $(date +%s) ))
  [ "$wait_s" -gt 0 ] && sleep "$wait_s"
  # A publish can take half an hour; too close to the job's time limit, leave it
  # to the next run, which publishes as it starts.
  [ $(( END - $(date +%s) )) -lt $(( 30 * 60 )) ] && break
  echo "publish at $(date -u +%H:%MZ)"
  publish
  save
done
wait "$WATCHER" 2>/dev/null
save
