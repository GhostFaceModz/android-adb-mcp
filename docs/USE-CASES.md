# android-use: use cases and how much control it has

This page goes into more detail than the [README](../README.md). The first half shows what people actually use `android-use` for, with the kind of thing you'd say to your AI assistant (Claude, Cursor, Hermes Agent, Grok Bot or any other MCP client) and what `android-use` then does on the phone. The second half explains exactly how much control it has, based on what the code really does.

The tool calls shown are illustrative. Your assistant chooses its own steps, and real runs usually include extra `ui_dump` or `screenshot` calls so it can check where it is.

## Contents

- [How a request turns into taps](#how-a-request-turns-into-taps)
- [What you can do with it](#what-you-can-do-with-it)
  - [Hands-free errands](#hands-free-errands)
  - [Repetitive taps](#repetitive-taps)
  - [Social posting from the phone](#social-posting-from-the-phone)
  - [Accessibility](#accessibility)
  - [Remote help for family](#remote-help-for-family)
- [How much control it has on your phone](#how-much-control-it-has-on-your-phone)
  - [At a glance](#at-a-glance)
  - [What it can do](#what-it-can-do)
  - [What it can't do](#what-it-cant-do)
  - [Safety guards in the code](#safety-guards-in-the-code)
  - [How to revoke access instantly](#how-to-revoke-access-instantly)
  - [Recommended safe setup](#recommended-safe-setup)

---

## How a request turns into taps

`android-use` doesn't understand your request itself. Your AI assistant does. The assistant reads your message, then calls `android-use` tools one at a time, looking at the result of each before deciding the next step:

1. **Look:** `current_app`, `ui_dump` (a text list of buttons and labels with their positions) or `screenshot` (an image of the screen).
2. **Act:** `open_app`, `tap_element`, `tap`, `swipe`, `long_press`, `type_text` or `key_event`.
3. **Check:** another `ui_dump` or `screenshot` to confirm it worked, then repeat.

`tap_element` is usually the most reliable way to press something, because it finds the button by its label (for example "Search" or "Start") instead of guessing pixel coordinates. `tap` with coordinates is the fallback for things that have no label, such as a video thumbnail or a game button.

---

## What you can do with it

### Hands-free errands

**How it helps.** When you're cooking, driving (as a passenger), carrying shopping or working on something at your desk, you can ask your assistant to do the fiddly phone bits: put on a video or live stream, start a playlist, open navigation, or set an alarm or timer.

**A real example.** The author connected his Samsung Galaxy Z Fold5 to his AI assistant over [Tailscale](https://tailscale.com/) (see [Connect to Grok Bot's computer](../README.md#connect-to-grok-bots-computer-tailscale--adb)). He asked it to open a YouTube channel's newest video, and later the same channel's live stream. Roughly, it did this:

> *"Open YouTube, go to [channel name] and play their newest video."*

1. `current_app` → the Samsung launcher, so the phone is unlocked and on the home screen.
2. `open_app { package: "com.google.android.youtube" }`
3. `ui_dump` → finds `desc="Search"`, then `tap_element { text: "Search" }`.
4. `type_text { text: "channel name" }`, then `key_event { key: "enter" }`.
5. `ui_dump` → finds the channel in the results, then `tap_element { text: "channel name" }`.
6. `tap_element { text: "Videos" }` to open the channel's Videos tab (newest first by default).
7. `tap` on the first thumbnail's centre, then `screenshot` to confirm it's playing.

> *"Now switch to their live stream."*

1. `key_event { key: "back" }` to go back to the channel page.
2. `tap_element { text: "Live" }` to open the Live tab, then `ui_dump` to find the item marked live.
3. `tap` on it, then `screenshot` to check the stream has started.

**More example prompts**

- *"Play my Discover Weekly playlist on Spotify and turn the volume up a couple of notches."* → `open_app { package: "com.spotify.music" }`, `tap_element { text: "Search" }`, `type_text`, `tap_element { text: "Discover Weekly" }`, `tap_element { text: "Play" }`, then `key_event { key: "volume_up" }` twice.
- *"Open Google Maps and start directions to the nearest Tesco."* → `open_app { package: "com.google.android.apps.maps" }`, `tap_element { text: "Search here" }`, `type_text { text: "Tesco" }`, `key_event { key: "enter" }`, `tap_element { text: "Directions" }`, `tap_element { text: "Start" }`.
- *"Set a 12-minute timer."* → `open_app` the clock app (`com.sec.android.app.clockpackage` on Samsung, `com.google.android.deskclock` on Pixel), `tap_element { text: "Timer" }`, enter the digits with `tap_element`, then `tap_element { text: "Start" }`.
- *"Set an alarm for 6:45 tomorrow morning."* → the same clock app, `tap_element { text: "Alarm" }`, the add button, set the time, then `tap_element { text: "Save" }`.

**Tools used:** `open_app`, `ui_dump`, `tap_element`, `tap`, `type_text`, `key_event` (`enter`, `back`, `volume_up`, `volume_down`, `play_pause`), `screenshot`.

**Tips and limits**

- The phone has to be **unlocked** with the screen on. `android-use` can't get past the lock screen (see [What it can't do](#what-it-cant-do)).
- If you don't know an app's package name, ask the assistant to run `list_apps { filter: "maps" }` first.
- Layouts change between app versions, screen sizes and languages. On a foldable, the cover screen and inner screen can show different layouts, so it's normal for the assistant to take a `ui_dump` before each step.
- `type_text` only types printable ASCII (plain English letters, numbers and common symbols). Searches with accents, other scripts or emoji won't type; see [What it can't do](#what-it-cant-do).
- Each step is a round trip to the AI, so a five-step task usually takes several seconds to a minute. It's for convenience, not speed.

---

### Repetitive taps

**How it helps.** Some phone chores are the same few taps every time: clearing notifications, checking for app updates, or a daily flow such as opening an app and collecting a daily reward or check-in bonus. You can describe the flow once and let the assistant do it.

**Example prompts**

- *"Pull down the notification shade and tap Clear."* → `get_screen_size`, `swipe` from the top edge downwards (for example `swipe { x1: 540, y1: 5, x2: 540, y2: 1400 }`), `ui_dump`, `tap_element { text: "Clear" }` (Samsung) or `tap_element { text: "Clear all" }` (Pixel), then `key_event { key: "home" }`.
- *"Open [game], collect the daily reward, then go back to the home screen."* → `open_app`, wait and `screenshot` to see the loading screen has finished, `tap_element { text: "Collect" }` (or `tap` on the button's position if it has no label), `screenshot` to confirm, `key_event { key: "home" }`.
- *"Open Galaxy Store and update everything."* → `open_app { package: "com.sec.android.app.samsungapps" }`, `tap_element { text: "Menu" }`, `tap_element { text: "Updates" }`, `tap_element { text: "Update all" }`.

**Running it on a schedule.** `android-use` only acts when an assistant calls it; it has no scheduler of its own. To make a flow run every morning, pair it with an AI agent that can run on a schedule, for example a cron job that runs Claude Code in headless mode, or an agent platform with scheduled tasks. Put the exact steps in the scheduled prompt and ask it to finish with a `screenshot` so you can see what happened.

**Tools used:** `swipe`, `ui_dump`, `tap_element`, `tap`, `screenshot`, `key_event` (`home`, `back`), `open_app`, `get_screen_size`.

**Tips and limits**

- **Google Play is blocked by default.** `com.android.vending` is on the built-in sensitive-app list because it can make purchases, so `open_app` and taps inside Play are refused. For Play updates, the simplest option is to turn on auto-update in Play's own settings. Turning the guard off with `ALLOW_SENSITIVE=1` turns it off for *every* app, so only do that while you're watching.
- Scheduled runs need the phone **unlocked**. If the screen has timed out and locked, the run will fail. Developer options → **Stay awake** keeps the screen on while charging, which helps for a phone on a stand, but it's less secure, so only use it on a phone that stays somewhere private.
- **Respect each app's terms of service.** Many games and apps ban automation, bots or "macros", especially anything that gives you an advantage over other players or farms rewards. Automating it can get your account suspended. Using `android-use` doesn't change those rules.
- The rate limit (120 tool calls a minute by default) stops a confused agent from tapping in a tight loop. That's plenty for normal flows.

---

### Social posting from the phone

**How it helps.** Some features only exist in the mobile app, such as TikTok's in-app editor and sounds, or Instagram Stories with stickers. Third-party schedulers often can't use them. Because `android-use` drives the real app, your assistant can prepare the post the same way you would.

**Example prompts**

- *"Open Instagram, start a new Story from the most recent photo in my gallery, and stop before sharing so I can check it."* → `open_app { package: "com.instagram.android" }`, `tap_element { text: "Your story" }`, `ui_dump`, `tap` on the first gallery thumbnail, `screenshot`, then it stops and shows you the screenshot.
- *"In TikTok, upload the newest video from my gallery, put this caption in, and leave it on the Post screen: Behind the scenes of today's build #maker"* → `open_app { package: "com.zhiliaoapp.musically" }` (the package can differ by region; use `list_apps { filter: "tiktok" }` or `filter: "musically"` to check), `tap_element { text: "Upload" }`, `tap` on the video, `tap_element { text: "Next" }`, `tap_element` on the caption field, `type_text`, then `screenshot`.
- *"Read me the comments on my latest post."* → open the app and the post, `ui_dump` to read the comment text, and `swipe` upwards to scroll for more.

**Tools used:** `open_app`, `tap_element`, `tap`, `type_text`, `swipe`, `ui_dump`, `screenshot`, `key_event`.

**Tips and limits**

- **Keep a human in the loop.** Ask the assistant to stop on the final screen and send you a `screenshot`, then press Post or Share yourself or tell it to go ahead. A wrong caption, tag or audience setting is public and hard to undo.
- **Write or approve captions yourself.** AI-written captions can be wrong, off-tone or misleading.
- **Emoji, accented letters and non-Latin scripts can't be typed** (`type_text` is ASCII-only). Put them in yourself, or type the caption on the phone first.
- **Respect platform rules.** TikTok, Instagram and others restrict automated or inauthentic activity: mass liking, following, commenting or posting by bot can get an account limited or banned. Use this to save yourself a few taps on posts you'd make anyway, not to fake engagement.
- Direct-message apps such as WhatsApp, Messenger, Signal and Telegram are on the sensitive-app list and are refused by default.

---

### Accessibility

**How it helps.** If touchscreens are hard for you, perhaps because of a tremor, limited hand movement, low vision or fatigue, you can control the phone by talking or typing to an AI assistant in plain language. The assistant works out the taps and swipes, and can read the screen back to you.

**Example prompts**

- *"What's on my screen right now?"* → `screenshot` and/or `ui_dump`, then the assistant describes it: *"You're in Settings → Display. There's a Brightness slider, Dark mode which is off, and Font size and style."*
- *"Turn on dark mode and make the text bigger."* → `open_app { package: "com.android.settings" }`, `tap_element { text: "Display" }`, `tap_element { text: "Dark" }`, `tap_element { text: "Font size and style" }`, then `swipe` on the slider and a `screenshot` to confirm.
- *"Open my email, read me the subject lines of the newest five, then open the one from the GP surgery."* → `open_app { package: "com.google.android.gm" }`, `ui_dump` to read the list, then `tap_element { text: "GP surgery" }` (or whatever the sender is called) and another `ui_dump` to read the message.
- *"Go back"*, *"Go home"*, *"Scroll down"*, *"Turn the volume down"* → `key_event { key: "back" }`, `key_event { key: "home" }`, `swipe`, `key_event { key: "volume_down" }`.

If your AI app has a voice mode, you can say all of this aloud.

**Tools used:** `ui_dump` (the text of what's on screen, which is great for reading back), `screenshot` (for images and anything without a text label), `tap_element`, `swipe`, `key_event`, `open_app`, `type_text`.

**Be realistic about what this is**

- **It complements Android's built-in accessibility tools; it doesn't replace them.** [TalkBack](https://support.google.com/accessibility/android/answer/6283677) (screen reader), [Voice Access](https://support.google.com/accessibility/android/answer/6151848) (hands-free control by voice), Select to Speak, Switch Access and magnification all run on the phone itself, work offline and work on the lock screen. `android-use` needs a computer running `adb`, a working connection to the phone, an AI service and an unlocked phone.
- It's slower than a direct tap, because each step goes through the AI.
- The AI can misread a screen or tap the wrong thing, so check before anything that matters. Sensitive apps (banking, payments, messaging, password managers) are refused by default, which is the right default for most people.
- Apps with poor labelling (unlabelled icon buttons) are harder for `ui_dump`; the assistant falls back to `screenshot` and coordinates.
- Screenshots go to your AI provider. Think about that before asking it to read private documents or health information.

---

### Remote help for family

**How it helps.** When a parent or relative says *"my phone's gone weird"*, you can fix it from wherever you are: turn the ringer back on, make the text bigger, turn off a setting they changed by accident, or find where an app went. You ask your assistant and it does it on their phone over [Tailscale](https://tailscale.com/) and ADB.

**Setting it up (once, together, in person or on a call)**

1. With their agreement, install Tailscale on their phone and add it to your tailnet (or share the device with you).
2. Turn on Developer options and USB debugging, plug it into a computer once, accept the **"Allow USB debugging?"** prompt (it shows your computer's key fingerprint; that's the moment they're granting access), and run `adb tcpip 5555`. The [Tailscale section in the README](../README.md#connect-to-grok-bots-computer-tailscale--adb) has the exact steps.
3. On your side, `adb connect <their-tailscale-ip>:5555`, and start `android-use` with `ADB_SERIAL=<their-tailscale-ip>:5555` so it can only ever touch their phone.

**Example prompts**

- *"Mum's phone isn't ringing. Check the sound mode and put it back on Sound with the ringtone volume at about 70%."* → `open_app { package: "com.android.settings" }`, `tap_element { text: "Sounds and vibration" }`, `ui_dump`, `tap_element { text: "Sound" }`, `swipe` on the ringtone slider, `screenshot` to confirm.
- *"Dad says the text is too small. Make the font one size bigger and turn on bold."* → Settings → Display → Font size and style, using `tap_element` and `swipe`.
- *"The WhatsApp icon has disappeared from the home screen. Find it and put it back."* → `key_event { key: "home" }`, `swipe` up to open the app drawer, `ui_dump` to find WhatsApp, `long_press` on it, then drag it with `swipe`. (Opening WhatsApp itself is blocked by the sensitive-app guard, but moving its icon on the launcher isn't.)

**Tools used:** `open_app`, `tap_element`, `swipe`, `long_press`, `key_event`, `ui_dump`, `screenshot`, `connect_wifi`.

**Consent and control, always**

- **Only do this with the phone owner's clear, informed consent.** Explain what you'll be able to see and do. Controlling someone's phone without permission is wrong, and in the UK it can be an offence under the Computer Misuse Act; similar laws apply elsewhere.
- **They can switch it off at any time:** turning off USB debugging or Wireless debugging, turning off Developer options, or disconnecting Tailscale ends your access immediately. Show them how. Restarting the phone also ends a session set up with `adb tcpip 5555`.
- Tell them before you start and when you've finished, and ask them to keep an eye on the screen while you work.
- Leave the sensitive-app guard on. You shouldn't be in their banking or messages, and the default list blocks those.
- Agree that they'll turn debugging off when it's not needed, and turn it back on next time they need help.

---

## How much control it has on your phone

Everything below is based on the source code in [`src/index.ts`](../src/index.ts) and [`src/adb.ts`](../src/adb.ts).

### At a glance

| Can | Can't | Off by default |
|---|---|---|
| See the screen (`screenshot`) | Get past the lock screen or bypass your PIN, pattern or fingerprint | Raw `shell` tool (`ALLOW_SHELL=1` to enable) |
| Read the on-screen UI as text (`ui_dump`) | Root the phone or gain system privileges | Using banking, payment, messaging and password apps (`ALLOW_SENSITIVE=1` to allow) |
| Tap, long-press and swipe anywhere on screen | Read apps' private data (chats, databases, saved logins) | Being limited to one device (set `ADB_SERIAL` to turn this on; recommended) |
| Type text into the focused field (ASCII only) | Do anything when USB and Wireless debugging are off | |
| Press keys: home, back, recents, volume, power, enter and more | Type emoji or non-ASCII text | |
| Open apps, list installed apps, see the foreground app | Listen to or speak into phone calls | |
| Connect to a phone over Wi-Fi or Tailscale (`connect_wifi`) | Work without a computer running `adb` that the phone has authorised | |

### What it can do

`android-use` sends standard `adb` commands from your computer to the phone. With those, the AI can:

- **See the screen:** `screenshot` returns a PNG of what's displayed.
- **Read the UI tree:** `ui_dump` runs `uiautomator dump` and returns a compact list of buttons, labels and text fields, with their text, description, resource ID and centre coordinates.
- **Tap, swipe and long-press:** `tap`, `swipe`, `long_press` and `tap_element` (find a button by text or resource ID, then tap its centre).
- **Type:** `type_text` types up to 1,000 characters of printable ASCII into whatever field has focus.
- **Press keys:** `key_event` sends named keys (`home`, `back`, `recents`, `enter`, `delete`, `tab`, `volume_up`, `volume_down`, `mute`, `play_pause`, `power`, `wakeup`, `sleep`, `camera`, `call`, `endcall`, `menu`, `search`, arrow keys) or any numeric Android keycode.
- **Open and list apps:** `open_app` launches an app by package name; `list_apps` lists installed packages (third-party only unless you ask for system apps); `current_app` reports the foreground app.
- **Manage connections:** `list_devices`, `get_screen_size` and `connect_wifi` (pair and connect over Wi-Fi).

In practice, that means **anything you could do by tapping the unlocked screen, the AI can do too**: change settings, install or uninstall apps through their normal screens, make calls, post things, or buy things in an app that isn't on the sensitive list. That's why the guards below matter.

### What it can't do

- **Get past the lock screen.** It can wake the screen (`key_event wakeup`), but it can't unlock the phone without your PIN, pattern or password, and it doesn't know them. Don't give your PIN to an AI.
- **Root the phone or gain extra privileges.** ADB commands run as Android's limited `shell` user. `android-use` contains no rooting or exploit code.
- **Read private app data.** Android's sandbox stops the `shell` user reading other apps' private storage, so it can't pull chat databases, saved passwords or app tokens. It can only see what's **on screen** while an app is open. Apps that mark screens as secure (many banking and streaming apps) show up black in screenshots.
- **Work when debugging is off.** If USB debugging and Wireless debugging are both off, or the phone hasn't authorised the computer's ADB key, nothing works. A session set up with `adb tcpip 5555` also ends when the phone restarts.
- **Type emoji or non-ASCII text.** `type_text` refuses anything outside printable ASCII (a limitation of `adb shell input text`).
- **Use phone-call audio.** It can press call and end-call keys, but it can't hear or speak on a call.
- **Work on iPhone.** There's no ADB on iOS.

### Safety guards in the code

All guards are set with environment variables in your MCP client's config. `ALLOW_SHELL` and `ALLOW_SENSITIVE` must be exactly `1` to switch on; anything else, including `true`, leaves them off.

| Variable | Default | What it does |
|---|---|---|
| `ADB_SERIAL` | not set (any connected device) | Comma-separated device allowlist. Every tool that touches a device refuses any serial not on the list, `list_devices` only shows listed devices, and the first entry is used when the assistant doesn't name a device. `connect_wifi` warns if you connect to an address that isn't listed, and other tools then refuse it. |
| `ALLOW_SENSITIVE` | off | Leave it off. When off, the sensitive-app guard is active (see below). `1` disables the guard for every app. |
| `SENSITIVE_PACKAGES` | empty | Extra package names to block, comma-separated, added to the built-in list. |
| `ALLOW_SHELL` | off | When off, the raw `shell` tool doesn't exist at all, so the AI can't even see it. `1` registers it. |
| `RATE_LIMIT_PER_MIN` | `120` | Maximum tool calls in any rolling 60 seconds. Extra calls fail with an error until the window frees up. Every call counts, including ones that fail. |
| `ADB_PATH` | `adb` | Which adb binary to run. |

**Device allowlist (`ADB_SERIAL`).** Without it, the assistant can control any device your computer can reach with `adb`, including other phones you've plugged in or connected before. With it, a request for any other serial fails with *"Device … is not in ADB_SERIAL allowlist"*.

**Sensitive-app guard (on unless `ALLOW_SENSITIVE=1`).** Before `screenshot`, `ui_dump`, `tap`, `tap_element`, `swipe`, `long_press`, `type_text` and most `key_event` calls, `android-use` checks which app is in the foreground. Before `open_app`, it checks the app being launched. If the app is sensitive, the call is refused. These packages are blocked by default:

| Category | Packages |
|---|---|
| Wallets and payments | `com.google.android.apps.walletnfcrel` (Google Wallet), `com.samsung.android.spay` (Samsung Wallet/Pay), `com.samsung.android.samsungpay.gear`, `com.paypal.android.p2pmobile` (PayPal), `com.venmo` (Venmo), `com.squareup.cash` (Cash App), `com.zellepay.zelle` (Zelle), `com.coinbase.android` (Coinbase) |
| Messaging | `com.whatsapp` (WhatsApp), `org.telegram.messenger` (Telegram), `org.thoughtcrime.securesms` (Signal), `com.google.android.apps.messaging` (Google Messages), `com.samsung.android.messaging` (Samsung Messages), `com.facebook.orca` (Messenger) |
| App store | `com.android.vending` (Google Play, because it can make purchases) |

Any package whose name contains one of these words is also blocked (case-insensitive): `bank`, `wallet`, `pay`, `finance`, `crypto`, `authenticator`, `messag`, `signal`, `keepass`, `bitwarden`, `1password`. Add your own with `SENSITIVE_PACKAGES`, for example `SENSITIVE_PACKAGES=co.uk.getmondo,com.revolut.revolut` (Monzo and Revolut, neither of which contains a keyword). Check the exact names on your phone with `list_apps`.

Things to know about this guard:

- `home`, `back`, `recents` and `power` keys **always** work, so the assistant can always leave a sensitive app.
- `list_devices`, `connect_wifi`, `get_screen_size`, `list_apps` and `current_app` aren't guarded. The AI can see *that* a banking app is installed or open, but not what's inside it.
- It's a **best-effort heuristic, not a security boundary.** Matching is on package names, so an app with an unusual name (many UK banks don't have "bank" in their package name) isn't caught unless you add it to `SENSITIVE_PACKAGES`, and harmless apps that happen to contain a keyword are blocked. If the foreground app can't be detected, the action is allowed. A sensitive app's content can also appear outside the app, for example in notifications.
- `ALLOW_SENSITIVE=1` is all-or-nothing. There's no way to unblock just one app.

**No raw shell by default (`ALLOW_SHELL`).** The other tools validate their inputs: package names and hosts are checked against strict patterns, coordinates must be whole numbers, typed text is safely quoted, and adb is always started with `execFile`, never through a shell on your computer. With `ALLOW_SHELL=1`, the assistant can run any `adb shell` command (up to 2,000 characters). That still runs as the limited `shell` user, but it can change settings, uninstall apps and more, and it **isn't** covered by the sensitive-app guard. Only enable it on a test device.

**Rate limit and action log.** Every tool call is counted against `RATE_LIMIT_PER_MIN` (120 by default) and written to stderr with a timestamp, the tool name and its arguments, for example `[android-use 2026-10-20T09:15:02.123Z] tool tap {"x":540,"y":1200}`. Text passed to `type_text` is logged as its length only (`"<12 chars>"`), never the text itself. Errors are logged too. Your MCP client decides where stderr goes; Claude Desktop, for example, keeps per-server log files. At start-up the server logs its settings: `allowlist=… shell=… sensitive=… rate=…/min`.

**No network code.** `android-use` itself makes no network connections apart from running `adb`. Screenshots and UI dumps go only to the MCP client that asked for them, but your client may send them to a cloud AI provider, so treat anything on screen as visible to that provider.

### How to revoke access instantly

Any one of these cuts the AI off. They're listed from quickest to most thorough:

1. **On the phone, turn off Wireless debugging** (Settings → Developer options → Wireless debugging) and/or **USB debugging**, or unplug the cable. Access stops straight away.
2. **Turn off Developer options** altogether (the switch at the top of Developer options). This turns off all debugging.
3. **Developer options → Revoke USB debugging authorisations.** This forgets every computer the phone has trusted, so each one has to be approved on the phone again.
4. **Disconnect Tailscale** on the phone if you were connected remotely.
5. **Restart the phone.** This ends a session set up with `adb tcpip 5555`.
6. **On the computer,** quit the AI app or remove the `android-use` entry from its MCP config, and run `adb disconnect` (or `adb kill-server`).

### Recommended safe setup

- **Set `ADB_SERIAL`** to exactly the phone you mean to control.
- **Leave `ALLOW_SENSITIVE` and `ALLOW_SHELL` unset.**
- **Add your own banking and finance apps** to `SENSITIVE_PACKAGES` if their package names don't contain an obvious keyword. Run `list_apps` to find their names.
- **Keep a screen lock on**, and lock sensitive apps with their own PIN or biometrics too.
- **Watch the screen** while the agent works, especially the first few times, and ask it to stop before anything public or paid.
- **Use a spare phone** for scheduled or unattended automation where you can.
- **Turn off Wireless debugging when you're done**, and revoke authorisations for computers you no longer use.
- **Be wary of prompt injection.** Text on screen (a web page, email, notification or comment) can try to give the AI instructions. Don't let it browse untrusted content unattended on a phone you care about.
