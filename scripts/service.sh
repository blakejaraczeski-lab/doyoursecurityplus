#!/usr/bin/env bash
# Run doyoursecurityplus as a per-user service, so the study server is always
# up and the durable state file is always being written: a launchd agent on
# macOS, a systemd user unit on Linux. The same commands on both.
#
#   ./scripts/service.sh install            start at login, keep alive
#   ./scripts/service.sh install --remind 18:30   also nudge daily at 18:30
#   ./scripts/service.sh status
#   ./scripts/service.sh logs               server.log (rotates at 1 MB, 3 kept) and crash.log
#   ./scripts/service.sh restart
#   ./scripts/service.sh uninstall
#   ./scripts/service.sh hooks              install the pre-commit hook that runs bin/check
#
# Backups are not launchd's business and work on any platform:
#   python3 scripts/backup.py backup        dated tarball to ~/.doyoursecurityplus-backups
#   python3 scripts/backup.py restore FILE  put one back, after a typed yes
#
# The platform's own supervisor is used rather than a container: it is native,
# needs nothing installed, starts with the session, and restarts the server if
# it ever exits. A container would add a dependency for what is a single-file
# Python server reading and writing one directory.
#
# On Linux a user unit runs while you are logged in. To keep it running after
# you log out: loginctl enable-linger "$USER" (your call; it changes how your
# account's services live, so this script never does it).

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
PLATFORM="${DYSP_PLATFORM:-$(uname -s | tr '[:upper:]' '[:lower:]')}"   # darwin | linux
UNIT_DIR="${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"
UNIT="doyoursecurityplus.service"
REMIND_UNIT="doyoursecurityplus-remind"
SYSTEMCTL="${DYSP_SYSTEMCTL:-systemctl}"   # the self test points this at a stub

die() { echo "error: $*" >&2; exit 1; }

load_agent() {  # label plist
  launchctl bootout "gui/$UID/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$2" 2>/dev/null || launchctl load -w "$2"
}

unload_agent() { # label plist
  launchctl bootout "gui/$UID/$1" 2>/dev/null || launchctl unload -w "$2" 2>/dev/null || true
}

# Sets REMIND_AT, HH and MM from install's arguments. One parser for both platforms.
REMIND_AT=""
parse_install() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --remind) REMIND_AT="${2:-}"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  if [[ -n "$REMIND_AT" ]]; then
    [[ "$REMIND_AT" =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ ]] || die "--remind needs HH:MM, got '$REMIND_AT'"
    HH="$((10#${REMIND_AT%%:*}))"; MM="$((10#${REMIND_AT##*:}))"
  fi
}

cmd_install() {
  parse_install "$@"
  local remind_at="$REMIND_AT"

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
    <string>/bin/sh</string>
    <string>$APP_DIR/scripts/capped-log.sh</string>
    <string>$LOG_DIR/crash.log</string>
    <string>$PYTHON</string>
    <string>$APP_DIR/serve.py</string>
    <string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DYSP_DATA</key><string>$DATA_DIR</string>
    <key>DYSP_LOG</key><string>$LOG_DIR/server.log</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG_DIR/crash.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/crash.log</string>
</dict>
</plist>
PLIST

  load_agent "$LABEL" "$PLIST"

  if [[ -n "$remind_at" ]]; then
    local hh="$HH" mm="$MM"
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
  health
}

health() {
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

# server.log rotates itself at 1 MB with three old files kept; crash.log holds
# only what Python printed before it could log, capped at 256 KB per launch.
cmd_logs() {
  tail -n "${1:-40}" "$LOG_DIR/server.log" 2>/dev/null || echo "no server log yet"
  if [[ -s "$LOG_DIR/crash.log" ]]; then echo; echo "== crash.log"; tail -n 20 "$LOG_DIR/crash.log"; fi
}

cmd_hooks() {
  ln -sf ../../scripts/hooks/pre-commit "$APP_DIR/.git/hooks/pre-commit"
  echo "pre-commit hook  -> $APP_DIR/.git/hooks/pre-commit (runs bin/check)"
}


# --- Linux: a systemd user unit ---------------------------------------------
# The same shape as the launchd agent: started with the session, restarted if
# it exits, DYSP_DATA and DYSP_LOG set, so serve.py writes and rotates its own
# log. Anything it prints before that goes to the journal, which bounds itself,
# so the launch-time cap macOS needs is not needed here.

q() { printf '"%s"' "${1//\"/\\\"}"; }   # systemd quoting, for paths with spaces

linux_install() {
  parse_install "$@"
  [[ -n "$PYTHON" ]] || die "python3 not found on PATH"
  mkdir -p "$UNIT_DIR" "$LOG_DIR"

  cat > "$UNIT_DIR/$UNIT" <<UNIT
[Unit]
Description=doyoursecurityplus study server on port $PORT

[Service]
Type=simple
ExecStart=$(q "$PYTHON") $(q "$APP_DIR/serve.py") $PORT
WorkingDirectory=$APP_DIR
Environment=$(q "DYSP_DATA=$DATA_DIR")
Environment=$(q "DYSP_LOG=$LOG_DIR/server.log")
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT

  if [[ -n "$REMIND_AT" ]]; then
    cat > "$UNIT_DIR/$REMIND_UNIT.service" <<UNIT
[Unit]
Description=doyoursecurityplus daily reminder

[Service]
Type=oneshot
ExecStart=$(q "$PYTHON") $(q "$APP_DIR/scripts/remind.py")
Environment=$(q "DYSP_DATA=$DATA_DIR")
Environment=$(q "DYSP_PORT=$PORT")
UNIT
    cat > "$UNIT_DIR/$REMIND_UNIT.timer" <<UNIT
[Unit]
Description=doyoursecurityplus daily reminder at $REMIND_AT

[Timer]
OnCalendar=*-*-* $(printf '%02d:%02d' "$HH" "$MM"):00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  fi

  "$SYSTEMCTL" --user daemon-reload
  "$SYSTEMCTL" --user enable --now "$UNIT"
  if [[ -n "$REMIND_AT" ]]; then
    "$SYSTEMCTL" --user enable --now "$REMIND_UNIT.timer"
    echo "daily reminder  -> $REMIND_AT"
  fi
  sleep 1
  echo "service         -> $UNIT (starts with your session, restarts if it exits)"
  echo "study portal    -> http://localhost:$PORT"
  echo "study data      -> $DATA_DIR"
  echo "logs            -> $LOG_DIR (and journalctl --user -u $UNIT)"
  echo "after logout    -> stops, unless you run: loginctl enable-linger $USER"
  linux_status
}

linux_uninstall() {
  "$SYSTEMCTL" --user disable --now "$UNIT" 2>/dev/null || true
  "$SYSTEMCTL" --user disable --now "$REMIND_UNIT.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$UNIT" "$UNIT_DIR/$REMIND_UNIT.service" "$UNIT_DIR/$REMIND_UNIT.timer"
  "$SYSTEMCTL" --user daemon-reload
  echo "service removed. Your study data in $DATA_DIR is untouched."
}

linux_restart() {
  [[ -f "$UNIT_DIR/$UNIT" ]] || die "not installed; run: ./scripts/service.sh install"
  "$SYSTEMCTL" --user restart "$UNIT"
  sleep 1
  linux_status
}

linux_status() {
  echo "status          -> $("$SYSTEMCTL" --user is-active "$UNIT" 2>/dev/null || true)"
  health
}

linux_logs() {
  tail -n "${1:-40}" "$LOG_DIR/server.log" 2>/dev/null || echo "no server log yet"
  if command -v journalctl >/dev/null; then echo; echo "== journal"; journalctl --user -u "$UNIT" -n 20 --no-pager 2>/dev/null || true; fi
}

if [[ "$PLATFORM" == linux ]]; then
  case "${1:-}" in
    install)   shift; linux_install "$@"; exit ;;
    uninstall) linux_uninstall; exit ;;
    restart)   linux_restart; exit ;;
    status)    linux_status; exit ;;
    logs)      shift; linux_logs "${1:-40}"; exit ;;
  esac
elif [[ "$PLATFORM" != darwin && "${1:-}" != hooks && -n "${1:-}" ]]; then
  die "no service support for $PLATFORM; run python3 serve.py under your own supervisor"
fi

case "${1:-}" in
  install)   shift; cmd_install "$@" ;;
  uninstall) cmd_uninstall ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      shift; cmd_logs "${1:-40}" ;;
  hooks)     cmd_hooks ;;
  *) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
