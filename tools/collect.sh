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
# results are captured every 4 minutes without pause, including while the model,
# picks, ledger and record are published (about 6 minutes). If the watcher
# crashes it is started again.
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
# Save every 15 minutes (so a job killed at its time limit loses at most that)
# and publish about once an hour. Runs used to be 6 x (55 min + publish) = about
# 366 minutes against a 355-minute limit, and three of five were killed before
# their last save, losing up to an hour of prices each time.
last_pub=$(date +%s)
while [ "$(date +%s)" -lt "$END" ]; do
  left=$(( END - $(date +%s) ))
  sleep $(( left < 900 ? left : 900 ))
  if [ $(( $(date +%s) - last_pub )) -ge $(( MINUTES * 60 )) ] && [ $(( END - $(date +%s) )) -ge $(( 20 * 60 )) ]; then
    echo "publish at $(date -u +%H:%MZ)"
    publish
    last_pub=$(date +%s)
  fi
  save
done
wait "$WATCHER" 2>/dev/null
save
