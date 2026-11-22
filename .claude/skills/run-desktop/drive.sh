#!/usr/bin/env bash
# The desktop app under the REPL driver (driver.mjs), inside tmux.
#   drive.sh start           install playwright-core if needed, start the driver
#   drive.sh send "<cmd>"    send one command to the driver and print its answer
#   drive.sh stop            close the app and the driver
#   drive.sh where           the folder of the screenshots and the logs
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="${SB_DRIVER_SESSION:-sb-desktop-driver}"
DEPS="${SB_DRIVER_DEPS:-$HOME/.cache/switchboard-desktop-driver}"
TMP="${TMPDIR:-/tmp}"
OUT="${SB_DRIVER_OUT:-${TMP%/}/switchboard-desktop-driver}"
TRANSCRIPT="$OUT/driver.out"
TIMEOUT="${SB_DRIVER_TIMEOUT:-120}"
PLAYWRIGHT_VERSION="1.49.1"

answers() { grep -c -- '^---$' "$TRANSCRIPT" 2>/dev/null || true; }

case "${1:-}" in
  start)
    command -v tmux >/dev/null || { echo "tmux is needed"; exit 1; }
    if tmux has-session -t "$SESSION" 2>/dev/null; then echo "already running ($SESSION)"; exit 0; fi
    if [ ! -d "$DEPS/node_modules/playwright-core" ]; then
      echo "installing playwright-core@$PLAYWRIGHT_VERSION in $DEPS"
      mkdir -p "$DEPS"
      npm install --prefix "$DEPS" "playwright-core@$PLAYWRIGHT_VERSION" --no-audit --no-fund --silent
    fi
    mkdir -p "$OUT"
    : > "$TRANSCRIPT"
    prefix=""
    if [ "$(uname)" = "Linux" ] && [ -z "${DISPLAY:-}" ]; then prefix="xvfb-run -a"; fi
    cmd="SB_DRIVER_OUT=$(printf %q "$OUT") SB_DRIVER_DEPS=$(printf %q "$DEPS") $prefix node $(printf %q "$HERE/driver.mjs") 2>&1 | tee -a $(printf %q "$TRANSCRIPT")"
    tmux new-session -d -s "$SESSION" -x 200 -y 50 "$cmd"
    for _ in $(seq 1 30); do
      [ "$(answers)" -gt 0 ] && break
      sleep 0.5
    done
    cat "$TRANSCRIPT"
    ;;
  send)
    [ -n "${2:-}" ] || { echo 'usage: drive.sh send "<command>"'; exit 1; }
    tmux has-session -t "$SESSION" 2>/dev/null || { echo "not running: drive.sh start first"; exit 1; }
    before="$(answers)"
    tmux send-keys -t "$SESSION" -l "$2"
    tmux send-keys -t "$SESSION" Enter
    for _ in $(seq 1 $((TIMEOUT * 2))); do
      [ "$(answers)" -gt "$before" ] && break
      sleep 0.5
    done
    awk -v n="$before" '/^---$/ { c++; next } c == n' "$TRANSCRIPT"
    ;;
  stop)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux send-keys -t "$SESSION" -l "quit"
      tmux send-keys -t "$SESSION" Enter
      sleep 3
      tmux kill-session -t "$SESSION" 2>/dev/null || true
    fi
    echo "stopped"
    ;;
  where)
    echo "$OUT"
    ;;
  *)
    sed -n '2,6p' "$0"
    exit 1
    ;;
esac
