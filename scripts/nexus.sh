#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXUS_BIN="$REPO_ROOT/dist/nexus/main.js"
FILESCOPE_DIR="$HOME/.filescope"
PID_FILE="$FILESCOPE_DIR/nexus.pid"
LOG_FILE="$FILESCOPE_DIR/nexus.log"
PORT=1234

is_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  [[ -f "$PID_FILE" ]] && cat "$PID_FILE" || true
}

cmd_start() {
  local pid
  pid="$(read_pid)"
  if is_alive "$pid"; then
    echo "nexus already running (pid $pid)"
    return 0
  fi
  rm -f "$PID_FILE"

  if [[ ! -f "$NEXUS_BIN" ]]; then
    echo "nexus binary missing at $NEXUS_BIN"
    echo "run: npm run build:nexus"
    return 1
  fi

  mkdir -p "$FILESCOPE_DIR"
  nohup node "$NEXUS_BIN" >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"

  sleep 0.5
  if is_alive "$new_pid"; then
    echo "nexus started (pid $new_pid) on port $PORT"
    echo "logs: $LOG_FILE"
  else
    rm -f "$PID_FILE"
    echo "nexus failed to start — tail $LOG_FILE"
    return 1
  fi
}

cmd_stop() {
  local pid
  pid="$(read_pid)"
  if ! is_alive "$pid"; then
    echo "nexus not running"
    rm -f "$PID_FILE"
    return 0
  fi
  kill "$pid"
  for _ in 1 2 3 4 5 6; do
    is_alive "$pid" || break
    sleep 0.5
  done
  if is_alive "$pid"; then
    echo "graceful shutdown timed out, sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "nexus stopped"
}

cmd_status() {
  local pid
  pid="$(read_pid)"
  if is_alive "$pid"; then
    local port_state="not listening"
    if ss -tln 2>/dev/null | grep -q ":$PORT "; then
      port_state="listening"
    fi
    echo "nexus: running (pid $pid), port $PORT $port_state"
  else
    echo "nexus: not running"
    if [[ -f "$PID_FILE" ]]; then
      echo "  stale pid file: $PID_FILE"
    fi
  fi
}

case "${1:-}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
