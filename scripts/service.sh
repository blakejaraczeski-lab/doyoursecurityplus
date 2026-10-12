#!/usr/bin/env bash
# macOS only. Run doyoursecurityplus as a launchd user agent, so the study
# server is always up and the durable state file is always being written. On
# Linux run `python3 serve.py` under your own supervisor; a systemd unit is on
# the ship list and not written yet.
#
#   ./scripts/service.sh install            start at login, keep alive
#   ./scripts/service.sh install --remind 18:30   also nudge daily at 18:30
#   ./scripts/service.sh status
#   ./scripts/service.sh logs
#   ./scripts/service.sh restart
#   ./scripts/service.sh uninstall
#   ./scripts/service.sh hooks              install the pre-commit hook that runs bin/check
#
# macOS launchd is used rather than a container: it is native, needs nothing
# installed, starts at login without a daemon of its own, and restarts the
# server if it ever exits. A container would add a dependency for what is a
# single-file Python server reading and writing one directory.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.doyoursecurityplus.server"
REMIND_LABEL="com.doyoursecurityplus.remind"
AGENTS="$HOME/Library/LaunchAgents"
PLIST="$AGENTS/$LABEL.plist"
REMIND_PLIST="$AGENTS/$REMIND_LABEL.plist"
DATA_DIR="${DYSP_DATA:-$HOME/.doyoursecurityplus}"
LOG_DIR="$DATA_DIR/logs"
PORT="${DYSP_PORT:-8777}"
PYTHON="$(command -v python3)"

die() { echo "error: $*" >&2; exit 1; }

load_agent() {  # label plist
  launchctl bootout "gui/$UID/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$2" 2>/dev/null || launchctl load -w "$2"
}

unload_agent() { # label plist
  launchctl bootout "gui/$UID/$1" 2>/dev/null || launchctl unload -w "$2" 2>/dev/null || true
}

cmd_install() {
  local remind_at=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --remind) remind_at="${2:-}"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done

  [[ -n "$PYTHON" ]] || die "python3 not found on PATH"
  mkdir -p "$AGENTS" "$LOG_DIR"

  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$APP_DIR/serve.py</string>
    <string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>DYSP_DATA</key><string>$DATA_DIR</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/server.err.log</string>
</dict>
</plist>
PLIST

  load_agent "$LABEL" "$PLIST"

  if [[ -n "$remind_at" ]]; then
    [[ "$remind_at" =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ ]] || die "--remind needs HH:MM, got '$remind_at'"
    local hh="${remind_at%%:*}" mm="${remind_at##*:}"
    cat > "$REMIND_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$REMIND_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$APP_DIR/scripts/remind.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DYSP_DATA</key><string>$DATA_DIR</string>
    <key>DYSP_PORT</key><string>$PORT</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$((10#$hh))</integer><key>Minute</key><integer>$((10#$mm))</integer></dict>
  <key>StandardOutPath</key><string>$LOG_DIR/remind.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/remind.err.log</string>
</dict>
</plist>
PLIST
    load_agent "$REMIND_LABEL" "$REMIND_PLIST"
    echo "daily reminder  -> $remind_at"
  fi

  sleep 1
  echo "service         -> $LABEL (starts at login, restarts if it exits)"
  echo "study portal    -> http://localhost:$PORT"
  echo "study data      -> $DATA_DIR"
  echo "logs            -> $LOG_DIR"
  cmd_status
}

cmd_uninstall() {
  unload_agent "$LABEL" "$PLIST"
  unload_agent "$REMIND_LABEL" "$REMIND_PLIST"
  rm -f "$PLIST" "$REMIND_PLIST"
  echo "service removed. Your study data in $DATA_DIR is untouched."
}

cmd_restart() {
  [[ -f "$PLIST" ]] || die "not installed; run: ./scripts/service.sh install"
  load_agent "$LABEL" "$PLIST"
  sleep 1
  cmd_status
}

cmd_status() {
  if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
    echo "status          -> loaded"
  else
    echo "status          -> not loaded"
  fi
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    curl -fsS "http://localhost:$PORT/api/health" | "$PYTHON" -c '
import json, sys
h = json.load(sys.stdin)
print("health          -> reachable, %d reviews, %d open, %d cleared, %d snapshots" % (
    h.get("reviews", 0), h.get("misconceptionsOpen", 0),
    h.get("misconceptionsRetired", 0), h.get("snapshots", 0)))'
  else
    echo "health          -> not reachable on port $PORT"
  fi
}

cmd_logs() { tail -n "${1:-40}" "$LOG_DIR/server.log" "$LOG_DIR/server.err.log" 2>/dev/null || echo "no logs yet"; }

cmd_hooks() {
  ln -sf ../../scripts/hooks/pre-commit "$APP_DIR/.git/hooks/pre-commit"
  echo "pre-commit hook  -> $APP_DIR/.git/hooks/pre-commit (runs bin/check)"
}

case "${1:-}" in
  install)   shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      shift; cmd_logs "${1:-40}" ;;
  hooks)     cmd_hooks ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
