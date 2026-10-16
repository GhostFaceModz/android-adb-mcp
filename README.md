# android-adb-mcp

A small [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI assistant (Cursor, Claude Desktop, any MCP client) **see and control an Android phone over ADB**: take screenshots, read the UI tree, tap, swipe, type, press keys and launch apps.

It is a thin TypeScript wrapper around the `adb` command-line tool and talks to your client over stdio. Two runtime dependencies: `@modelcontextprotocol/sdk` and `zod`.

> ⚠️ **Read the [Safety](#safety--risks) section before you connect a phone you care about.** An AI with this tool can do anything you could do by tapping on the screen.

> **Status: v0.1, not yet tested on real hardware.** The build passes and a smoke test runs every tool against a mocked `adb`. The real `adb` binary was checked too (version, server start, `devices`), but no phone was attached. Bug reports from real Samsung/Pixel devices are welcome.

*Not affiliated with, endorsed by, or sponsored by Google, Android, or Samsung. "Android" is a trademark of Google LLC.*

## Demo flow

> **You:** "Open YouTube and search for lo-fi beats."

1. `current_app` → `com.sec.android.app.launcher`
2. `open_app { package: "com.google.android.youtube" }`
3. `ui_dump` → `#4 ImageView [clickable] desc="Search" center=980,140 …`
4. `tap_element { text: "Search" }`
5. `type_text { text: "lo-fi beats" }`, then `key_event { key: "enter" }`
6. `screenshot` so the assistant can check the result

## Setup

### 1. Install ADB (Android platform-tools)
- **macOS:** `brew install --cask android-platform-tools`
- **Windows:** `winget install Google.PlatformTools`, or download [platform-tools](https://developer.android.com/tools/releases/platform-tools) and add the folder to `PATH`
- **Linux:** `sudo apt install adb` (or the platform-tools zip above)

Check it with `adb version`.

### 2. Enable Developer options and debugging on the phone
1. **Settings → About phone → Software information** (Samsung) or **About phone** (Pixel/others). Tap **Build number** 7 times and enter your PIN.
2. **Settings → Developer options** → turn on **USB debugging**, and/or **Wireless debugging** (Android 11+).
3. *Samsung:* if taps are ignored, check that **Auto Blocker** (Settings → Security and privacy) is off while you use ADB. On some ROMs (e.g. Xiaomi) you also need **USB debugging (Security settings)** before input injection works.

### 3. Connect
**USB:** plug in the phone, accept the "Allow USB debugging?" prompt, then run `adb devices`.

**Wireless (Android 11+):** Developer options → Wireless debugging → **Pair device with pairing code**. That screen shows an IP, a *pairing* port and a 6-digit code. The main Wireless debugging screen shows a different *connect* port.
```bash
adb pair 192.168.1.23:41234 123456     # pairing port + code
adb connect 192.168.1.23:37099          # connect port
```
Or ask the assistant to call `connect_wifi { host, port, pairing_code, pair_port }`.

### 4. Build and run
```bash
git clone https://github.com/GhostFaceModz/android-adb-mcp
cd android-adb-mcp
npm install && npm run build
npm test            # smoke test with mocked adb, no phone needed
```

## Connect to Grok Bot's computer (remote, over Tailscale)

Let Grok Bot control your phone from its own cloud computer:

1. Install [Tailscale](https://tailscale.com/) on your phone and sign in. Ask Grok Bot to install Tailscale on its computer and join the same account (you approve the login). Check that each can see the other's `100.x.x.x` address.
2. Android only allows wireless-debugging pairing from the same local Wi-Fi, so do a one-time USB setup from any PC:
   ```bash
   adb devices          # accept the prompt on the phone
   adb tcpip 5555
   ```
   Unplug the phone afterwards.
3. Ask Grok Bot to connect. It runs:
   ```bash
   adb connect <phone-tailscale-ip>:5555
   ```
   and then starts this MCP server with `ADB_SERIAL=<phone-tailscale-ip>:5555`.
4. Keep the phone awake on Wi-Fi or mobile data with Tailscale connected. Restarting the phone turns TCP mode off, so repeat step 2 after a reboot.

When you're finished, turn off USB/Wireless debugging and disconnect Tailscale on the phone.

## MCP client configuration

**Cursor** (`~/.cursor/mcp.json`) / **Claude Desktop** (`claude_desktop_config.json`) / any client using the generic `mcpServers` JSON:
```json
{
  "mcpServers": {
    "android": {
      "command": "node",
      "args": ["/absolute/path/to/android-adb-mcp/dist/index.js"],
      "env": {
        "ADB_SERIAL": "R5CT1234ABC",
        "RATE_LIMIT_PER_MIN": "120"
      }
    }
  }
}
```
Restart the client after you edit the config. On Windows, use `C:\\path\\to\\dist\\index.js`. If `adb` isn't on the client's PATH, set `ADB_PATH`.

### Environment variables
| Variable | Default | Meaning |
|---|---|---|
| `ADB_SERIAL` | *(any)* | Comma-separated allowlist of device serials (`adb devices`). Every other device is refused. **Recommended.** |
| `ALLOW_SHELL` | off | `1` registers the raw `shell` tool. |
| `ALLOW_SENSITIVE` | off | `1` turns off the sensitive-app guard. |
| `SENSITIVE_PACKAGES` | | Extra package names to treat as sensitive (comma-separated). |
| `RATE_LIMIT_PER_MIN` | `120` | Maximum tool calls per minute. |
| `ADB_PATH` | `adb` | Path to the adb binary. |

## Tools
| Tool | What it does |
|---|---|
| `list_devices` | Connected devices (filtered by allowlist) |
| `connect_wifi` | `adb pair` (optional, with code) + `adb connect host:port` |
| `screenshot` | PNG screenshot returned as an MCP image |
| `get_screen_size` | `wm size` |
| `tap` | Tap at x,y |
| `swipe` | Swipe x1,y1 → x2,y2 over `ms` |
| `long_press` | Hold at x,y for `ms` |
| `type_text` | Type into the focused field (printable ASCII; safely quoted) |
| `key_event` | home, back, recents, enter, power, volume_up/down, delete, tab, … or a numeric keycode |
| `open_app` | Launch by package name |
| `list_apps` | Installed packages (third-party by default, optional filter) |
| `current_app` | Foreground package |
| `ui_dump` | `uiautomator dump`, returned as a compact list of clickable/labelled elements with center coordinates |
| `tap_element` | Find an element by text/content-desc or resource-id and tap it |
| `shell` | Raw `adb shell`. **Only registered when `ALLOW_SHELL=1`** |

Every tool except `list_devices`/`connect_wifi` takes an optional `serial`.

## Optional: AI voice calls with Twilio (planned)

> **Status:** planned add-on, not built yet. This section explains what it is and how to get ready for it.

### What it is
ADB can start, answer and hang up calls on your phone, but Android won't let any app speak into, or listen to, a live SIM call unless the phone is rooted. To give Grok Bot a real voice on calls, you use [Twilio](https://www.twilio.com/), a cloud phone service. Twilio gives you a phone number, and Grok Bot can make and receive calls on it.

### What you can do with it
- **Outbound calls:** Grok Bot rings a number and speaks for you, for example to book an appointment or check opening hours.
- **Inbound calls:** Grok Bot answers your Twilio number like a receptionist, takes messages and sends you a summary.
- **Two-way conversation:** it speaks with text-to-speech and hears the caller through Twilio Media Streams with live speech-to-text.
- **Transcripts and summaries** of every call, sent to you in chat.
- **Call forwarding:** forward your SIM to the Twilio number when you're busy, and Grok Bot picks up.

### Setup
1. Create a [Twilio account](https://www.twilio.com/try-twilio) and verify your own number.
2. Buy a voice-capable phone number. It costs roughly £1 to $1.15 a month, and calls are a few pence or cents a minute.
3. From the Twilio Console, copy your **Account SID** and **Auth Token**.
4. Give them to Grok Bot as secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`). Never paste them into a public repo.
5. Grok Bot runs a small voice bridge (a webhook plus a media-stream server) and points your Twilio number's voice webhook at it.
6. Optionally, set up call forwarding on your phone so missed calls go to the Twilio number.

### Rules and safety
- Calls come from the Twilio number, not your SIM.
- Many countries, including the UK, US and EU, require you to tell people they're talking to an AI or being recorded. The voice bridge will announce this at the start of each call.
- Don't use it for spam, robocalls or impersonation. That breaks Twilio's terms and the law.
- Set a spending limit in the Twilio Console.

## Safety & risks

**This gives an AI model remote control of your phone.** It could send messages, buy things, change settings, delete data or read anything on screen. Models make mistakes and can be steered by text they see (prompt injection from a web page, email or notification).

Guardrails in v0.1:
- **Device allowlist:** set `ADB_SERIAL` so only your chosen device can be controlled.
- **Sensitive-app guard:** screenshot, ui_dump, tap, swipe, type and most keys are refused while a banking, payment, wallet, messaging or password-manager app is in the foreground. `open_app` refuses to launch those apps. Detection uses a built-in package list plus keyword matching (`bank`, `pay`, `wallet`, `messag`, …). It is a best-effort heuristic, not a security boundary. Home/back/recents/power always work, so you can get out of a sensitive app. Override with `ALLOW_SENSITIVE=1`.
- **No raw shell by default:** `shell` exists only when `ALLOW_SHELL=1`. Other tools validate their inputs and never run a shell on your computer (adb is invoked with `execFile`).
- **Rate limiting:** default 120 calls/min.
- **Logging:** every tool call is logged to stderr (your MCP client's log). Typed text is logged as a length only.
- **Local only:** the server has no network code of its own. Screenshots and UI dumps go only to the MCP client that requested them. Whatever your client does with them (e.g. sending them to a cloud LLM) is up to the client. Assume screenshots may leave your machine through your AI provider.

Recommendations: use a spare or test device where possible, keep sensitive apps locked, watch the screen while it runs, and turn off Wireless debugging when you're done.

## Roadmap
- Live screen streaming via scrcpy
- Scroll-until-found / wait-for-element helpers
- Unicode text input (via an ADB keyboard IME)
- Per-tool confirmation prompts (MCP elicitation)
- **iOS is not supported** (and not planned; there is no ADB equivalent)

## License
MIT. See [LICENSE](LICENSE).
