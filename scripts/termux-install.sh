#!/usr/bin/env bash
# android-use phone-only installer for Termux (no PC, no root).
#
#   curl -fsSL https://raw.githubusercontent.com/GhostFaceModz/android-adb-mcp/main/scripts/termux-install.sh | bash
#
# Options (env vars):
#   DRY_RUN=1            print what would run, change nothing
#   ANDROID_USE_PKG=...  npm spec to install (default @ghostfacemodz/android-use; e.g. github:GhostFaceModz/android-adb-mcp)
#   SKIP_UPDATE=1        skip `pkg update/upgrade`
#   BOOT=1               also install a Termux:Boot script that starts android-use after reboot
#   FORCE=1              run even if this doesn't look like Termux (for testing)
set -euo pipefail

PKG_SPEC="${ANDROID_USE_PKG:-@ghostfacemodz/android-use}"
DRY="${DRY_RUN:-0}"
BIN_DIR="${PREFIX:-/data/data/com.termux/files/usr}/bin"
REPO_RAW="https://raw.githubusercontent.com/GhostFaceModz/android-adb-mcp/main"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
run()  { if [ "$DRY" = "1" ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }
write_file() { # write_file <path> <mode>  (content on stdin)
  if [ "$DRY" = "1" ]; then printf '[dry-run] write %s (mode %s):\n' "$1" "$2"; sed 's/^/    | /'; else cat > "$1"; chmod "$2" "$1"; fi
}

is_termux() { [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *com.termux* ]]; }
if ! is_termux && [ "${FORCE:-0}" != "1" ] && [ "$DRY" != "1" ]; then
  warn "This doesn't look like Termux. Install Termux from F-Droid (https://f-droid.org/packages/com.termux/) and run this inside it."
  warn "On a computer, use: npx -y @ghostfacemodz/android-use setup"
  exit 1
fi

say "android-use phone-only installer"
if [ "${SKIP_UPDATE:-0}" != "1" ]; then
  say "Updating Termux packages (answer Y/N prompts about config files with Enter)"
  run pkg update -y
  run pkg upgrade -y
fi

say "Installing Node.js, adb (android-tools) and helpers"
run pkg install -y nodejs-lts android-tools termux-tools curl

say "Installing cloudflared (for the public https link)"
if [ "$DRY" = "1" ] || ! command -v cloudflared >/dev/null 2>&1; then
  if ! run pkg install -y cloudflared; then
    warn "pkg install cloudflared failed; downloading the official linux-arm build instead"
    case "$(uname -m)" in
      aarch64|arm64) CF=cloudflared-linux-arm64 ;;
      armv7l|armv8l|arm) CF=cloudflared-linux-arm ;;
      x86_64) CF=cloudflared-linux-amd64 ;;
      i686|i386) CF=cloudflared-linux-386 ;;
      *) CF="" ;;
    esac
    if [ -n "$CF" ]; then
      run pkg install -y resolv-conf || true   # Go binaries need /etc/resolv.conf for DNS
      run curl -fL -o "$BIN_DIR/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/$CF"
      run chmod 755 "$BIN_DIR/cloudflared"
    else
      warn "No cloudflared build for $(uname -m). android-use will still run locally; see docs/PHONE-ONLY.md for other tunnels."
    fi
  fi
fi

say "Installing android-use ($PKG_SPEC)"
run npm install -g "$PKG_SPEC"

say "Creating helper commands in $BIN_DIR"
write_file "$BIN_DIR/android-use-setup" 755 <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# Guided setup: pair this phone with itself, create your token, open a public https link.
termux-wake-lock 2>/dev/null || true
exec android-use setup "$@"
EOS
write_file "$BIN_DIR/android-use-start" 755 <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# Start with the saved phone + token and a public https link (Ctrl+C to stop).
termux-wake-lock 2>/dev/null || true
exec android-use start --tunnel "$@"
EOS
if [ "$DRY" = "1" ]; then
  run curl -fsSL -o "$BIN_DIR/android-use-keepalive" "$REPO_RAW/scripts/keepalive.sh"
else
  KA="$(npm root -g)/@ghostfacemodz/android-use/scripts/keepalive.sh"
  if [ -f "$KA" ]; then cp "$KA" "$BIN_DIR/android-use-keepalive"; else curl -fsSL -o "$BIN_DIR/android-use-keepalive" "$REPO_RAW/scripts/keepalive.sh"; fi
  chmod 755 "$BIN_DIR/android-use-keepalive"
fi
write_file "$BIN_DIR/android-use-bg" 755 <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# Run in the background and auto-restart: android-use-bg [start|stop|restart|status|url|log]
cmd="${1:-start}"; [ $# -gt 0 ] && shift
if [ "$cmd" = "start" ] && [ $# -eq 0 ]; then set -- --tunnel; fi
exec android-use-keepalive "$cmd" "$@"
EOS
write_file "$BIN_DIR/android-use-url" 755 <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# Show the current public link (it changes every time the tunnel restarts).
exec android-use-keepalive url
EOS
write_file "$BIN_DIR/android-use-key" 755 <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# Print your secret key. Never share it: anyone with the link + key controls this phone.
cat "${MCP_AUTH_TOKEN_FILE:-${ANDROID_USE_HOME:-$HOME/.config/android-use}/token}"
EOS

if [ "${BOOT:-0}" = "1" ]; then
  say "Installing Termux:Boot autostart (~/.termux/boot/android-use.sh)"
  run mkdir -p "$HOME/.termux/boot"
  write_file "$HOME/.termux/boot/android-use.sh" 755 <<'EOS'
#!/data/data/com.termux/files/usr/bin/bash
# Started by Termux:Boot after the phone boots. Wireless debugging must be on and the phone on
# Wi-Fi; its port changes after a reboot, which `android-use start` tries to rediscover via mDNS
# (if that fails, run android-use-setup again).
termux-wake-lock
sleep 30
android-use-keepalive start --tunnel
EOS
fi

cat <<'EOT'

✓ Installed. Next steps:
  1. Settings → About phone → tap "Build number" 7 times (Developer options).
  2. Settings → Developer options → turn on "Wireless debugging".
  3. Put Termux and Settings in split screen, then run:   android-use-setup
     (it asks for the pairing port + code from "Pair device with pairing code",
      then the port on the main Wireless debugging screen)
  4. Paste the printed link into your AI app.

Later:  android-use-start   (foreground)   ·   android-use-bg start|stop|status   (background)
        android-use-url     (current link) ·   android-use-key   (your secret key, never share it)
Guide:  https://github.com/GhostFaceModz/android-adb-mcp/blob/main/docs/PHONE-ONLY.md
EOT
