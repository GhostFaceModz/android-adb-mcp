# android-use

**Let AI agents see and control an Android phone over ADB, with safety guards built in.**

[![npm](https://img.shields.io/npm/v/@ghostfacemodz/android-use)](https://www.npmjs.com/package/@ghostfacemodz/android-use)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`android-use` is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. Any MCP-capable app (Claude Desktop, Claude Code, Cursor, Hermes Agent and others) can use it to take screenshots, read the on-screen UI, tap, swipe, type, press keys and launch apps on a real Android device.

```bash
npx -y @ghostfacemodz/android-use
```

> Formerly **`android-adb-mcp`**. The tools, environment variables and behaviour are unchanged; only the package name, binary name (`android-use`) and MCP server name changed.

> ⚠️ **Read [Safety](#safety) before you connect a phone you care about.** An AI with this tool can do anything you could do by tapping the screen.

<!-- mcp-name: io.github.GhostFaceModz/android-use -->

*Not affiliated with, endorsed by, or sponsored by Google, Android or Samsung. "Android" is a trademark of Google LLC.*

---

## Contents
- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Phone setup](#phone-setup)
- [Add it to your MCP client](#add-it-to-your-mcp-client): [Claude Desktop](#claude-desktop) · [Claude Code](#claude-code) · [Cursor](#cursor) · [Hermes Agent](#hermes-agent) · [Other clients](#other-clients-generic-stdio)
- [Configuration](#configuration)
- [Tools](#tools)
- [Safety](#safety)
- [Connect to Grok Bot's computer (Tailscale + ADB)](#connect-to-grok-bots-computer-tailscale--adb)
- [Development](#development)

## What it does

`android-use` is a small TypeScript wrapper around the `adb` command-line tool. It talks to your MCP client over stdio and has two runtime dependencies (`@modelcontextprotocol/sdk` and `zod`).

Example: *"Open YouTube and search for lo-fi beats."*

1. `current_app` → `com.sec.android.app.launcher`
2. `open_app { package: "com.google.android.youtube" }`
3. `ui_dump` → `#4 ImageView [clickable] desc="Search" center=980,140 …`
4. `tap_element { text: "Search" }`
5. `type_text { text: "lo-fi beats" }`, then `key_event { key: "enter" }`
6. `screenshot` to check the result

## Requirements

- **Node.js 18 or newer** (provides `npx`)
- **ADB** (Android platform-tools) on your `PATH`, or set `ADB_PATH`
  - macOS: `brew install --cask android-platform-tools`
  - Windows: `winget install Google.PlatformTools`, or download [platform-tools](https://developer.android.com/tools/releases/platform-tools) and add the folder to `PATH`
  - Linux: `sudo apt install adb` (or the platform-tools zip)
  - Check with `adb version`
- **An Android phone with USB debugging or Wireless debugging enabled** (see below)

## Phone setup

1. **Enable Developer options:** Settings → About phone (Samsung: → Software information) → tap **Build number** 7 times.
2. **Enable debugging:** Settings → Developer options → turn on **USB debugging** and/or **Wireless debugging** (Android 11+).
3. *Samsung:* if taps are ignored, turn off **Auto Blocker** (Settings → Security and privacy) while using ADB. *Xiaomi and some other ROMs:* also enable **USB debugging (Security settings)**.

**Connect over USB:** plug in the phone, accept the "Allow USB debugging?" prompt, then run `adb devices`.

**Connect wirelessly (Android 11+):** Developer options → Wireless debugging → **Pair device with pairing code**. That screen shows an IP, a *pairing* port and a 6-digit code; the main Wireless debugging screen shows a different *connect* port.

```bash
adb pair 192.168.1.23:41234 123456     # pairing port + code
adb connect 192.168.1.23:37099         # connect port
```

You can also ask the assistant to call `connect_wifi { host, port, pairing_code, pair_port }`.

Run `adb devices` and note your device's serial. You'll use it for `ADB_SERIAL`.

## Add it to your MCP client

Every client runs the same command: `npx -y @ghostfacemodz/android-use`. Setting `ADB_SERIAL` to your phone's serial is optional but strongly recommended. Restart the client after editing its config.

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "android-use": {
      "command": "npx",
      "args": ["-y", "@ghostfacemodz/android-use"],
      "env": {
        "ADB_SERIAL": "R5CT1234ABC"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add android-use -- npx -y @ghostfacemodz/android-use
```

With a device allowlist:

```bash
claude mcp add android-use --env ADB_SERIAL=R5CT1234ABC -- npx -y @ghostfacemodz/android-use
```

Add `--scope user` to make it available in every project. Check it with `claude mcp list`.

### Cursor

Create `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` to make it available everywhere:

```json
{
  "mcpServers": {
    "android-use": {
      "command": "npx",
      "args": ["-y", "@ghostfacemodz/android-use"],
      "env": {
        "ADB_SERIAL": "R5CT1234ABC"
      }
    }
  }
}
```

### Hermes Agent

Add it under `mcp_servers` in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  android_use:
    command: "npx"
    args: ["-y", "@ghostfacemodz/android-use"]
    env:
      ADB_SERIAL: "R5CT1234ABC"
    timeout: 120          # per-tool-call timeout in seconds
    connect_timeout: 60
```

Restart Hermes (or reload MCP). The tools show up with the `mcp_android_use_` prefix, for example `mcp_android_use_screenshot`. See the [Hermes MCP docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) for the other options, such as `tools.include` / `tools.exclude`.

### Other clients (generic stdio)

Any MCP client that can launch a stdio server works:

| Field | Value |
|---|---|
| Transport | `stdio` |
| Command | `npx` |
| Args | `-y`, `@ghostfacemodz/android-use` |
| Env (optional) | `ADB_SERIAL`, `ALLOW_SHELL`, `ALLOW_SENSITIVE`, `SENSITIVE_PACKAGES`, `RATE_LIMIT_PER_MIN`, `ADB_PATH` |

Or install it globally and use the `android-use` binary directly:

```bash
npm install -g @ghostfacemodz/android-use
android-use        # speaks MCP over stdin/stdout; logs go to stderr
```

**Windows notes:** if your client can't find `npx`, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "@ghostfacemodz/android-use"]`. If `adb` isn't on the client's `PATH`, set `ADB_PATH`, for example `C:\\platform-tools\\adb.exe`.

## Configuration

All configuration is through environment variables.

| Variable | Default | Meaning |
|---|---|---|
| `ADB_SERIAL` | *(any device)* | Comma-separated allowlist of device serials (from `adb devices`). Every other device is refused. **Recommended.** |
| `ALLOW_SHELL` | off | `1` registers the raw `shell` tool. |
| `ALLOW_SENSITIVE` | off | `1` turns off the sensitive-app guard. |
| `SENSITIVE_PACKAGES` | | Extra package names to treat as sensitive (comma-separated). |
| `RATE_LIMIT_PER_MIN` | `120` | Maximum tool calls per minute. |
| `ADB_PATH` | `adb` | Path to the adb binary. |

## Tools

| Tool | What it does |
|---|---|
| `list_devices` | Connected devices (filtered by the allowlist) |
| `connect_wifi` | `adb pair` (optional, with code) + `adb connect host:port` |
| `screenshot` | PNG screenshot returned as an MCP image |
| `get_screen_size` | Screen resolution (`wm size`) |
| `tap` | Tap at x,y |
| `swipe` | Swipe x1,y1 → x2,y2 over `ms` |
| `long_press` | Hold at x,y for `ms` |
| `type_text` | Type into the focused field (printable ASCII, safely quoted) |
| `key_event` | home, back, recents, enter, power, volume_up/down, delete, tab, … or a numeric keycode |
| `open_app` | Launch an app by package name |
| `list_apps` | Installed packages (third-party by default, optional filter) |
| `current_app` | Foreground package |
| `ui_dump` | `uiautomator dump` as a compact list of clickable/labelled elements with center coordinates |
| `tap_element` | Find an element by text/content-desc or resource-id and tap it |
| `shell` | Raw `adb shell`. **Only registered when `ALLOW_SHELL=1`** |

Every tool except `list_devices` and `connect_wifi` takes an optional `serial`.

## Safety

**This gives an AI model remote control of your phone.** It could send messages, buy things, change settings, delete data or read anything on screen. Models make mistakes and can be steered by text they see (prompt injection from a web page, email or notification).

Built-in guards:

- **Device allowlist:** set `ADB_SERIAL` and only those devices can be controlled. Requests for other serials are refused.
- **Sensitive-app guard:** `screenshot`, `ui_dump`, `tap`, `swipe`, `type_text` and most keys are refused while a banking, payment, wallet, messaging or password-manager app is in the foreground, and `open_app` refuses to launch those apps. Detection uses a built-in package list plus keyword matching (`bank`, `pay`, `wallet`, `messag`, …). This is a best-effort heuristic, not a security boundary. Home, back, recents and power always work, so the assistant can leave a sensitive app. Override with `ALLOW_SENSITIVE=1`.
- **No raw shell by default:** the `shell` tool only exists when `ALLOW_SHELL=1`. All other tools validate their inputs, and adb is invoked with `execFile`, never through a shell on your computer.
- **Rate limiting:** 120 tool calls per minute by default (`RATE_LIMIT_PER_MIN`).
- **Logging:** every tool call is logged to stderr (your MCP client's log). Typed text is logged as a length only.
- **Local only:** the server has no network code of its own. Screenshots and UI dumps go only to the MCP client that asked for them. Your client may send them to a cloud LLM, so assume screenshots can leave your machine through your AI provider.

Recommendations: use a spare or test device where you can, keep sensitive apps locked, watch the screen while the agent works, and turn off Wireless debugging when you're done.

## Connect to Grok Bot's computer (Tailscale + ADB)

Grok Bot can control your phone from its own cloud computer, running `android-use` there:

1. Install [Tailscale](https://tailscale.com/) on your phone and sign in. Ask Grok Bot to install Tailscale on its computer and join the same tailnet (you approve the login). Check that each side can see the other's `100.x.x.x` address.
2. Android only allows wireless-debugging pairing from the same local Wi-Fi, so do a one-time USB setup from any PC:
   ```bash
   adb devices          # accept the prompt on the phone
   adb tcpip 5555
   ```
   Then unplug the phone.
3. Ask Grok Bot to connect. It runs:
   ```bash
   adb connect <phone-tailscale-ip>:5555
   ```
   and starts the server with the phone allowlisted:
   ```bash
   ADB_SERIAL=<phone-tailscale-ip>:5555 npx -y @ghostfacemodz/android-use
   ```
4. Keep the phone awake on Wi-Fi or mobile data with Tailscale connected. Rebooting the phone turns TCP mode off, so repeat step 2 after a restart.

When you're finished, turn off USB/Wireless debugging and disconnect Tailscale on the phone.

## Optional: AI voice calls with Twilio (planned)

> **Status:** planned add-on, not built yet.

ADB can start, answer and hang up calls, but Android won't let an app speak into or listen to a live SIM call without root. The planned add-on uses [Twilio](https://www.twilio.com/) instead: a Twilio number that Grok Bot can call out from and answer, with text-to-speech, live speech-to-text over Twilio Media Streams, and transcripts and summaries of each call.

To get ready: create a Twilio account, buy a voice-capable number (about $1.15 a month plus per-minute charges), and keep the **Account SID**, **Auth Token** and number as secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`). Never commit them. Calls come from the Twilio number, not your SIM. Many jurisdictions (including the UK, US and EU) require you to tell people they're talking to an AI or being recorded, so the bridge will announce this at the start of each call. Don't use it for spam, robocalls or impersonation, and set a spending limit in the Twilio Console.

## Development

```bash
git clone https://github.com/GhostFaceModz/android-adb-mcp
cd android-adb-mcp
npm install
npm test             # builds, then runs a smoke test against a mocked adb (no phone needed)
node dist/index.js   # run the server from source
```

Test the published package with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx -y @ghostfacemodz/android-use
```

### Roadmap
- Live screen streaming via scrcpy
- Scroll-until-found and wait-for-element helpers
- Unicode text input (via an ADB keyboard IME)
- Per-tool confirmation prompts (MCP elicitation)
- **iOS is not supported** and not planned (there is no ADB equivalent)

## License

MIT. See [LICENSE](LICENSE).
