# Phone-only setup (no PC, no root)

This guide runs `android-use` **on the phone it controls**, inside [Termux](https://termux.dev). The phone connects to itself over Android's **Wireless debugging**, and a free Cloudflare quick tunnel gives you a private `https://…/mcp` link you can paste into Claude.ai, ChatGPT, Cursor, LibreChat, Open WebUI or LM Studio.

You need: Android 11 or newer, Wi-Fi (Wireless debugging only works while connected to Wi-Fi), and about 300 MB of free space.

> ⚠️ Anyone with your link **and** key can control this phone (within the [safety guards](../README.md#safety): no raw shell, banking/payment/messaging apps blocked). Never post them, screenshot them or paste them into a shared chat. Read [Security](#security) before you start.

---

## 1. Install Termux (from F-Droid, not the Play Store)

1. Install **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/) (or the [GitHub releases](https://github.com/termux/termux-app/releases)). The old Play Store build is outdated and its package repositories break; don't mix builds from different sources.
2. Optional: install **Termux:Boot** from F-Droid too, if you want android-use to start automatically after a reboot ([step 7](#7-optional-start-automatically-after-a-reboot-termuxboot)).
3. Open Termux once and let it finish setting up.

## 2. Run the installer

In Termux:

```bash
curl -fsSL https://raw.githubusercontent.com/GhostFaceModz/android-adb-mcp/main/scripts/termux-install.sh | bash
```

It runs `pkg update`, installs `nodejs-lts`, `android-tools` (adb), `cloudflared` and `termux-tools`, installs `android-use` with npm, and adds these commands:

| Command | What it does |
|---|---|
| `android-use-setup` | Guided setup: pair the phone with itself, create your key, open a public link |
| `android-use-start` | Start again with the saved settings and a fresh public link (foreground, Ctrl+C to stop) |
| `android-use-bg start\|stop\|restart\|status\|url\|log` | Run in the background and restart automatically if it stops |
| `android-use-url` | Show the current link |
| `android-use-key` | Show your secret key |

Installer options (put them before `bash`, e.g. `... | BOOT=1 bash`): `DRY_RUN=1` shows what it would do without changing anything, `BOOT=1` installs the Termux:Boot autostart script, `SKIP_UPDATE=1` skips `pkg upgrade`, `ANDROID_USE_PKG=github:GhostFaceModz/android-adb-mcp` installs straight from GitHub.

If `pkg update` asks about replacing config files, press Enter to keep the default.

## 3. Turn on Developer options and Wireless debugging

1. **Settings → About phone** (Samsung: **→ Software information**) → tap **Build number** 7 times and enter your PIN. You'll see "You are now a developer".
2. **Settings → Developer options** (Samsung: at the bottom of Settings) → turn on **Wireless debugging**. Allow it for the current Wi-Fi network if asked.
3. *Samsung:* if taps are ignored later, turn off **Auto Blocker** (Settings → Security and privacy). *Xiaomi/Redmi/POCO:* also turn on **USB debugging (Security settings)**.

## 4. Pair the phone with itself (split screen)

The pairing code disappears as soon as you leave the Settings screen, so show Termux and Settings at the same time:

1. Open **Recents**, tap the Termux icon at the top of its card → **Open in split screen view** (or *pop-up view*). Put **Settings → Developer options → Wireless debugging** in the other half.
2. In Termux run:
   ```bash
   android-use-setup
   ```
3. When it asks, choose **`p`** (pair). In Settings tap **Pair device with pairing code**. You'll see *IP address & Port* (e.g. `192.168.1.20:37099`) and a 6-digit code.
4. Type the **port after the colon** (e.g. `37099`) and the **code**. (If mDNS works on your phone, setup shows the port in `[brackets]` and you can just press Enter.)
5. Next it asks for the **Wireless debugging port**: that's the *different* port on the main Wireless debugging screen, under *IP address & Port* (e.g. `41235`). Type it.
6. Android may show **"Allow wireless debugging?"**: tap **Allow**.

Setup connects to `127.0.0.1:<port>`, locks android-use to that device only, creates your secret key (stored in `~/.config/android-use/token`, readable only by Termux) and remembers everything in `~/.config/android-use/config.json`.

You only pair once. Later, only the connect port can change (see [Troubleshooting](#troubleshooting)).

## 5. Get your link and add it to your AI app

Answer **Y** when setup offers the public https URL. After a few seconds it prints:

```
MCP URL:  https://<random-words>.trycloudflare.com/mcp
Header:   Authorization: Bearer <your key>
Key URL:  https://<random-words>.trycloudflare.com/mcp?key=<your key>
```

plus ready-to-paste configs. Use them like this (details in the [README](../README.md#use-as-a-connector-remote-mcp-over-https)):

- **Claude.ai / Claude app:** Settings → Connectors → Add custom connector → paste the **Key URL**.
- **ChatGPT (web, developer mode):** Settings → Apps → Advanced settings → Developer mode → Create app → paste the **Key URL**, Authentication **No authentication**.
- **Cursor, LM Studio, LibreChat, Open WebUI:** use the **MCP URL** with the `Authorization: Bearer <key>` header.

Long-press in Termux to select and copy text, or run `android-use-url` / `android-use-key` later. Then ask your assistant something harmless first, like *"What's on my phone screen?"*.

## 6. Keep it running

Android aggressively stops background apps. To keep android-use alive:

1. **Wake lock:** the helper commands take one automatically (Termux shows a notification "wake lock held"). You can also tap **Acquire wakelock** in the Termux notification. Release it with `termux-wake-unlock`.
2. **Battery optimisation off for Termux:** Settings → Apps → Termux → Battery → **Unrestricted** (Samsung: also remove Termux from *Sleeping apps* / *Deep sleeping apps* in Battery → Background usage limits).
3. **Run in the background:** `android-use-bg start` (stops with `android-use-bg stop`). It restarts android-use if it exits. Check with `android-use-bg status`; logs: `android-use-bg log`.
4. **Android 12+ "phantom process killer":** Android may kill Termux's child processes (node, cloudflared) with `[Process completed (signal 9)]`. On Android 14+, turn on **Developer options → Disable child process restrictions**. On Android 12/13 you can use the adb you just set up:
   ```bash
   adb -s 127.0.0.1:<port> shell "settings put global settings_enable_monitor_phantom_procs false"
   # Android 12 (not 12L) instead:
   adb -s 127.0.0.1:<port> shell "device_config set_sync_disabled_for_tests persistent; device_config put activity_manager max_phantom_processes 2147483647"
   ```
5. Keep the phone on Wi-Fi. Wireless debugging switches off when Wi-Fi disconnects.

## 7. Optional: start automatically after a reboot (Termux:Boot)

1. Install **Termux:Boot** from F-Droid and open it once.
2. Re-run the installer with `BOOT=1`:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/GhostFaceModz/android-adb-mcp/main/scripts/termux-install.sh | SKIP_UPDATE=1 BOOT=1 bash
   ```
   This creates `~/.termux/boot/android-use.sh`, which takes a wake lock and runs `android-use-bg start` 30 seconds after boot.
3. After a reboot, **Wireless debugging is usually off** until you're on a trusted Wi-Fi network and may need turning on again; its port also changes. `android-use start` looks for the new port automatically via mDNS. If it can't find it, run `android-use-setup` again (no re-pairing needed, just choose `c` and type the new port).
4. The tunnel link is new after every restart: check it with `android-use-url` and update it in your AI apps.

## Reconnect after a reboot or Wi-Fi change

1. Make sure you're on Wi-Fi and **Wireless debugging** is on.
2. Run `android-use-start` (or `android-use-bg restart`). It reconnects to the saved port, and if that port changed it tries to find the new one automatically.
3. If it says the device isn't connected: run `android-use-setup`, choose **`c`** and type the port from the Wireless debugging screen. If it says *failed to authenticate*, choose **`p`** and pair again.
4. Paste the new link into your apps (`android-use-url`).

## Troubleshooting

| Problem | Fix |
|---|---|
| **The port changed** / `failed to connect to 127.0.0.1:…` | Wireless debugging picks a new port after reboot, toggling, or a Wi-Fi change. Run `android-use-setup` → `c` → new port. |
| **`device offline`** | Turn Wireless debugging off and on, then `adb disconnect` and run `android-use-setup` again. Check you're still on Wi-Fi. |
| **`unauthorized`** | Unlock the phone and accept "Allow wireless debugging?". If there's no prompt: Developer options → **Revoke USB debugging authorisations**, then pair again. |
| **Pairing code vanished / "pairing failed"** | You left the pairing dialog. Use split screen so it stays open, and type the code within a minute. Use the *pairing* port, not the main one. |
| **Termux killed** / `[Process completed (signal 9)]` | Battery → Unrestricted, wake lock on, and the phantom-process fix in [step 6](#6-keep-it-running). Use `android-use-bg start`, which restarts automatically. |
| **Tunnel URL changed** | Normal for free quick tunnels: every restart gets a new random URL. Run `android-use-url` and update your apps. For a stable URL use a named Cloudflare tunnel or Tailscale Funnel on a computer. |
| **cloudflared "has not connected"** | Your network blocks Cloudflare's tunnel port 7844 (some workplace/school Wi-Fi). Try another network. |
| **Taps do nothing (Samsung)** | Turn off **Auto Blocker** while using ADB. |
| **Screenshots are black** | That app marks its screen as secure; it can't be captured. |
| `pkg` errors / mirrors failing | Run `termux-change-repo`, pick another mirror, then `pkg update`. Make sure Termux is from F-Droid/GitHub. |
| `android-use: command not found` | Re-run the installer, or `npm install -g @ghostfacemodz/android-use`. |

## Security

- **Never share the link or key.** Together they give full control of your phone (except what the [guards](../README.md#safety) block). The `?key=` link contains the key, so treat it like a password: don't paste it into public chats, screenshots or bug reports.
- **Rotate the key** if it might have leaked: `rm ~/.config/android-use/token && android-use-bg restart` (a new key is generated; update your apps).
- The server only listens on `127.0.0.1` on the phone; the outside world reaches it only through the tunnel, and every request needs the key.
- The `shell` tool stays off and banking, payment, wallet and messaging apps stay blocked unless you change `ALLOW_SHELL` / `ALLOW_SENSITIVE` (don't, on a phone you care about).
- To cut access instantly: `android-use-bg stop`, or turn off **Wireless debugging**. Revoke everything with Developer options → **Revoke USB debugging authorisations**.
- Your AI app sees whatever is on screen when it takes a screenshot. Lock sensitive apps and watch what it does.
