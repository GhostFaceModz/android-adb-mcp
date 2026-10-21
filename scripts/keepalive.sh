#!/usr/bin/env bash
# Keep `android-use start` running in the background and restart it if it exits.
# Works on Linux, macOS and Termux.
#
#   scripts/keepalive.sh start [start-options...]   e.g. start --tunnel   or   start --funnel
#   scripts/keepalive.sh stop | restart | status | url | log
#
# Env: ANDROID_USE_BIN (command to run; default: `android-use` if installed, else `npx -y @ghostfacemodz/android-use`)
#      ANDROID_USE_HOME (config dir; default ~/.config/android-use)
set -u

HOME_DIR="${ANDROID_USE_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/android-use}"
LOG="$HOME_DIR/android-use.log"
PIDF="$HOME_DIR/keepalive.pid"
ARGSF="$HOME_DIR/keepalive.args"
mkdir -p "$HOME_DIR"
chmod 700 "$HOME_DIR" 2>/dev/null || true

if [ -n "${ANDROID_USE_BIN:-}" ]; then BIN="$ANDROID_USE_BIN"
elif command -v android-use >/dev/null 2>&1; then BIN="android-use"
else BIN="npx -y @ghostfacemodz/android-use"; fi

running() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

loop() {
  # shellcheck disable=SC2046
  set -- $(cat "$ARGSF" 2>/dev/null)
  while true; do
    {
      echo "[keepalive $(ts)] starting: $BIN start --yes --hide-token $*"
      # shellcheck disable=SC2086
      $BIN start --yes --hide-token "$@" 2>&1 < /dev/null
      echo "[keepalive $(ts)] exited with $?; restarting in 5s"
    } >> "$LOG"
    sleep 5
  done
}

cmd="${1:-status}"; [ $# -gt 0 ] && shift
case "$cmd" in
  start)
    if running; then echo "already running (pid $(cat "$PIDF"))"; exit 0; fi
    printf '%s ' "$@" > "$ARGSF"
    if command -v setsid >/dev/null 2>&1; then nohup setsid bash "$0" _loop > /dev/null 2>&1 < /dev/null &
    else nohup bash "$0" _loop > /dev/null 2>&1 < /dev/null & fi
    echo $! > "$PIDF"
    command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
    echo "started (pid $!). Log: $LOG"
    echo "The public URL appears in a few seconds: $0 url" ;;
  _loop) loop ;;
  stop)
    if running; then pid="$(cat "$PIDF")"; kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; fi
    rm -f "$PIDF"
    pkill -f "android-use.* start --yes --hide-token" 2>/dev/null || true
    pkill -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:" 2>/dev/null || true
    command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
    echo "stopped" ;;
  restart)
    read -r -a saved < "$ARGSF" 2>/dev/null || saved=()
    bash "$0" stop; sleep 1; bash "$0" start "${saved[@]}" ;;
  status)
    if running; then echo "running (pid $(cat "$PIDF"))"; else echo "stopped"; fi
    bash "$0" url ;;
  url)
    f="$HOME_DIR/connection.json"
    if [ -f "$f" ]; then node -e 'const c=require(process.argv[1]);console.log("public: "+(c.publicUrl||"(none yet)")+"\nlocal:  "+c.localUrl+"\ntoken file: "+c.tokenFile)' "$f"
    else echo "no connection info yet (see $LOG)"; fi ;;
  log) tail -n 50 "$LOG" ;;
  *) echo "usage: $0 start [--tunnel|--funnel] | stop | restart | status | url | log"; exit 1 ;;
esac
