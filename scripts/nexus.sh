#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXUS_BIN="$REPO_ROOT/dist/nexus/main.js"
WATCHERS_DRIVER="$REPO_ROOT/scripts/watchers.mjs"
WATCHERS_JS="$REPO_ROOT/dist/mcp-server.js"
WATCHERS_TMPL="$REPO_ROOT/scripts/filescope-watchers.service.tmpl"

FILESCOPE_DIR="$HOME/.filescope"
PID_FILE="$FILESCOPE_DIR/nexus.pid"
LOG_FILE="$FILESCOPE_DIR/nexus.log"
PORT=1234

USER_SYSTEMD_DIR="$HOME/.config/systemd/user"
WATCHERS_UNIT_NAME="filescope-watchers.service"
WATCHERS_UNIT_PATH="$USER_SYSTEMD_DIR/$WATCHERS_UNIT_NAME"

# ---- Colors (degrade gracefully when stdout is not a tty) ----
if [[ -t 1 ]]; then
  GREEN='\033[1;32m'
  YELLOW='\033[1;33m'
  RED='\033[1;31m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; CYAN=''; NC=''
fi

ok()   { echo -e "${GREEN}  [OK] $*${NC}"; }
info() { echo -e "${CYAN}  [..] $*${NC}"; }
warn() { echo -e "${YELLOW}  [!!] $*${NC}"; }
fail() { echo -e "${RED}  [FAIL] $*${NC}"; }
die()  { fail "$*"; exit 1; }

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

cmd_install_watchers() {
  command -v systemctl >/dev/null 2>&1 \
    || die "systemctl not found — install-watchers requires systemd (Linux)"

  local node_bin
  node_bin="$(command -v node || true)"
  [[ -n "$node_bin" ]] || die "node not in PATH; install Node.js or add it to PATH first"

  [[ -f "$WATCHERS_DRIVER" ]] || die "watchers driver missing: $WATCHERS_DRIVER"
  [[ -f "$WATCHERS_JS" ]] \
    || die "$WATCHERS_JS missing — run ./build.sh (or: npm install && npm run build) first"
  [[ -f "$WATCHERS_TMPL" ]] || die "unit template missing: $WATCHERS_TMPL"

  mkdir -p "$USER_SYSTEMD_DIR"
  mkdir -p "$FILESCOPE_DIR"

  info "rendering $WATCHERS_UNIT_NAME"
  info "  Node:           $node_bin"
  info "  Watchers entry: $WATCHERS_DRIVER"

  sed -e "s|__NODE__|${node_bin}|g" \
      -e "s|__WATCHERS_JS__|${WATCHERS_DRIVER}|g" \
      "$WATCHERS_TMPL" > "$WATCHERS_UNIT_PATH"
  chmod 0644 "$WATCHERS_UNIT_PATH"
  ok "wrote $WATCHERS_UNIT_PATH"

  systemctl --user daemon-reload
  ok "user daemon-reloaded"

  if ! systemctl --user is-enabled --quiet "$WATCHERS_UNIT_NAME" 2>/dev/null; then
    systemctl --user enable "$WATCHERS_UNIT_NAME"
    ok "enabled at user login"
  else
    ok "already enabled"
  fi

  if systemctl --user is-active --quiet "$WATCHERS_UNIT_NAME" 2>/dev/null; then
    warn "$WATCHERS_UNIT_NAME already running. To apply unit changes, run:"
    warn "  systemctl --user restart $WATCHERS_UNIT_NAME"
  else
    systemctl --user start "$WATCHERS_UNIT_NAME"
    if systemctl --user is-active --quiet "$WATCHERS_UNIT_NAME"; then
      ok "$WATCHERS_UNIT_NAME started"
    else
      fail "$WATCHERS_UNIT_NAME failed to start"
      info "  systemctl --user status $WATCHERS_UNIT_NAME"
      info "  journalctl --user -u $WATCHERS_UNIT_NAME --no-pager -n 50"
      return 1
    fi
  fi

  info "logs:       $FILESCOPE_DIR/watchers.log"
  info "child logs: $FILESCOPE_DIR/watcher-logs/"
  info "status:     systemctl --user status $WATCHERS_UNIT_NAME"
}

cmd_uninstall_watchers() {
  command -v systemctl >/dev/null 2>&1 \
    || die "systemctl not found — uninstall-watchers requires systemd (Linux)"

  if systemctl --user is-active --quiet "$WATCHERS_UNIT_NAME" 2>/dev/null; then
    systemctl --user stop "$WATCHERS_UNIT_NAME"
    ok "stopped $WATCHERS_UNIT_NAME"
  else
    info "$WATCHERS_UNIT_NAME not running"
  fi

  if systemctl --user is-enabled --quiet "$WATCHERS_UNIT_NAME" 2>/dev/null; then
    systemctl --user disable "$WATCHERS_UNIT_NAME"
    ok "disabled $WATCHERS_UNIT_NAME"
  else
    info "$WATCHERS_UNIT_NAME not enabled"
  fi

  if [[ -f "$WATCHERS_UNIT_PATH" ]]; then
    rm -f "$WATCHERS_UNIT_PATH"
    ok "removed $WATCHERS_UNIT_PATH"
  else
    info "no unit file at $WATCHERS_UNIT_PATH"
  fi

  systemctl --user daemon-reload
  ok "user daemon-reloaded"
}

cmd_help() {
  cat <<EOF

Usage: $(basename "$0") COMMAND

Commands:
  start                Start the nexus daemon (HTTP UI on port $PORT).
  stop                 Stop the nexus daemon.
  status               Show nexus daemon status.
  install-watchers     Install + enable + start the per-repo watchers.
                       Renders a systemd user unit at:
                         $WATCHERS_UNIT_PATH
                       The unit spawns one dist/mcp-server.js child per
                       repo registered in ~/.filescope/nexus.json.
                       Idempotent — safe to re-run.
  uninstall-watchers   Stop, disable, and remove the user unit. Idempotent.
  -h, --help, help     Show this help.

The watchers unit Requires=filescope-broker.service. Install the broker
user unit yourself — this command does not ship one.

EOF
}

case "${1:-}" in
  start)               cmd_start ;;
  stop)                cmd_stop ;;
  status)              cmd_status ;;
  install-watchers)    cmd_install_watchers ;;
  uninstall-watchers)  cmd_uninstall_watchers ;;
  -h|--help|help)      cmd_help ;;
  "")                  cmd_help; exit 1 ;;
  *)
    fail "Unknown command: $1"
    cmd_help
    exit 1
    ;;
esac
