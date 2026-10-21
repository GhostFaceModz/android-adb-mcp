// `android-use setup` / `android-use start`: one-command remote-connector setup for your own phone.
import { execFile, spawn, ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

const ADB = process.env.ADB_PATH || "adb";
const isWin = platform() === "win32";
const isAndroid = platform() === "android" || !!process.env.TERMUX_VERSION;
const say = (...a: unknown[]) => console.log(...a);
const warn = (...a: unknown[]) => console.error(...a);

export const configDir = () =>
  process.env.ANDROID_USE_HOME ||
  (isWin ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "android-use") : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "android-use"));
export const tokenFilePath = () => process.env.MCP_AUTH_TOKEN_FILE || join(configDir(), "token");
const configPath = () => join(configDir(), "config.json");

type Saved = { serial?: string; port?: number };
const loadSaved = (): Saved => { try { return JSON.parse(readFileSync(configPath(), "utf8")); } catch { return {}; } };
const save = (s: Saved) => { mkdirSync(configDir(), { recursive: true, mode: 0o700 }); writeFileSync(configPath(), JSON.stringify(s, null, 2) + "\n"); };

function sh(cmd: string, args: string[], timeout = 20000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) =>
    resolve({ ok: !err, out: `${stdout || ""}${stderr || ""}`.trim() || (err ? (err as any).code === "ENOENT" ? "ENOENT" : err.message : "") })));
}

export function loadToken(): string | undefined {
  if (process.env.MCP_AUTH_TOKEN) return process.env.MCP_AUTH_TOKEN.trim() || undefined;
  const f = tokenFilePath();
  if (!existsSync(f)) return undefined;
  if (!isWin && statSync(f).mode & 0o077) warn(`WARNING: ${f} is readable by other users; run: chmod 600 "${f}"`);
  return readFileSync(f, "utf8").trim() || undefined;
}

export function ensureToken(): boolean {
  if (loadToken()) return false;
  const f = tokenFilePath();
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(f, randomBytes(32).toString("base64url") + "\n", { mode: 0o600 });
  if (!isWin) chmodSync(f, 0o600);
  return true;
}

const ADB_HINTS: Record<string, string> = {
  android: "  Termux: pkg install android-tools",
  win32: "  winget install Google.PlatformTools      (or: choco install adb / scoop install adb)",
  darwin: "  brew install android-platform-tools",
  linux: "  Debian/Ubuntu: sudo apt install adb    Fedora: sudo dnf install android-tools    Arch: sudo pacman -S android-tools",
};

async function checkAdb(): Promise<boolean> {
  const r = await sh(ADB, ["version"]);
  if (r.ok) { say(`✓ adb found (${r.out.split("\n")[0]})`); return true; }
  warn(`✗ adb not found${process.env.ADB_PATH ? ` at ADB_PATH=${ADB}` : " on PATH"}. Install Android platform-tools:`);
  warn(ADB_HINTS[isAndroid ? "android" : platform()] || ADB_HINTS.linux);
  warn("  or download: https://developer.android.com/tools/releases/platform-tools  (then set ADB_PATH or add it to PATH)");
  return false;
}

type Dev = { serial: string; state: string; info: string };
async function devices(): Promise<Dev[]> {
  const r = await sh(ADB, ["devices", "-l"]);
  return r.out.split("\n").slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith("*")).map((l) => {
    const [serial, state, ...rest] = l.split(/\s+/); return { serial, state, info: rest.join(" ") };
  });
}

/** Wireless-debugging endpoints advertised over mDNS (may be empty if mDNS is unavailable). */
async function mdns(): Promise<{ pair: string[]; connect: string[] }> {
  const r = await sh(ADB, ["mdns", "services"], 8000);
  const grab = (svc: string) => [...r.out.matchAll(new RegExp(`${svc}\\.?\\s+([\\d.]+:\\d+)`, "g"))].map((m) => m[1]);
  return { pair: grab("_adb-tls-pairing\\._tcp"), connect: grab("_adb-tls-connect\\._tcp") };
}
const adbConnect = async (hp: string) => { const c = await sh(ADB, ["connect", hp]); return /connected to/.test(c.out) && !/failed|unable/i.test(c.out); };

async function mdnsConnect(): Promise<string | undefined> {
  for (const hp of (await mdns()).connect) {
    // On the phone itself prefer 127.0.0.1:<port>: it keeps working when the Wi-Fi IP changes.
    for (const c of isAndroid ? [selfSerial(hp.split(":")[1]), hp] : [hp]) if (await adbConnect(c)) { say(`✓ auto-connected to wireless debugging device ${c}`); return c; }
  }
  return undefined;
}

/** Same-phone (Termux) serial: adb sees itself as 127.0.0.1:<port>. */
const selfSerial = (port: string) => `127.0.0.1:${port}`;

const PHONE_HELP_ANDROID = `
No phone connection yet. To let this phone control itself (no PC, no root):
  1. Settings → About phone → tap "Build number" 7 times (enables Developer options).
  2. Settings → Developer options → turn on "Wireless debugging" (needs Wi-Fi; any network works).
  3. Open Termux and Settings side by side (split screen / pop-up view).
  4. Wireless debugging → "Pair device with pairing code": note the PORT in "IP address & Port" and the 6-digit code.
  5. Enter them below. Then enter the (different) port shown on the main Wireless debugging screen.
`;
const PHONE_HELP = isAndroid ? PHONE_HELP_ANDROID : `
No phone found. Connect one of these ways:
  USB:       enable Developer options → USB debugging, plug in, accept the "Allow USB debugging?" prompt.
  Wireless:  (Android 11+, same Wi-Fi) Developer options → Wireless debugging → "Pair device with pairing code".
             Then run:  adb pair <ip>:<pair-port> <code>   and   adb connect <ip>:<port>
             (the connect port is shown on the Wireless debugging screen; it differs from the pair port)
  Or re-run setup with:  --pair <ip:port> --code <code> --connect <ip:port>
`;

async function findPhone(args: Args, rl?: ReturnType<typeof createInterface>): Promise<string | undefined> {
  if (isAndroid && args.pair && /^\d+$/.test(args.pair)) args.pair = selfSerial(args.pair);
  if (isAndroid && args.connect && /^\d+$/.test(args.connect)) args.connect = selfSerial(args.connect);
  if (args.pair) {
    if (!args.code) throw new Error("--pair needs --code <pairing code>");
    const r = await sh(ADB, ["pair", args.pair, args.code]); say(r.out);
  }
  if (args.connect) { const r = await sh(ADB, ["connect", args.connect]); say(r.out); }
  for (let attempt = 0; ; attempt++) {
    let list = await devices();
    if (!list.some((d) => d.state === "device") && attempt === 0) { await mdnsConnect(); list = await devices(); }
    const ready = list.filter((d) => d.state === "device");
    for (const d of list.filter((d) => d.state === "unauthorized")) warn(`! ${d.serial} is unauthorized: unlock the phone and accept the "Allow debugging?" prompt.`);
    for (const d of list.filter((d) => d.state === "offline")) warn(`! ${d.serial} is offline: toggle Wireless/USB debugging or reconnect.`);
    if (args.serial) {
      if (ready.some((d) => d.serial === args.serial)) return args.serial;
      if (attempt === 0 && /:\d+$/.test(args.serial) && (await adbConnect(args.serial))) continue;
      if (attempt === 0 && /:\d+$/.test(args.serial)) {
        // Wireless debugging ports change after reboot / toggling / Wi-Fi changes: look for the new one.
        const found = await mdnsConnect();
        if (found) { args.serial = found; say(`✓ wireless debugging port changed; now ${found}`); continue; }
      }
      warn(`! ${args.serial} is not connected${/:\d+$/.test(args.serial) ? " (its Wireless debugging port may have changed: run setup again)" : ""}.`);
      if (!rl) return undefined;
      args.serial = undefined;
    } else if (ready.length === 1) return ready[0].serial;
    else if (ready.length > 1) {
      say("Multiple devices:"); ready.forEach((d, i) => say(`  [${i + 1}] ${d.serial}  ${d.info}`));
      if (!rl) throw new Error("Several devices connected; pass --serial <serial>");
      const n = Number(await rl.question("Which one? [1] ")) || 1;
      if (ready[n - 1]) return ready[n - 1].serial;
      continue;
    }
    if (!rl) { warn(PHONE_HELP); return undefined; }
    warn(PHONE_HELP);
    const a = (await rl.question("[p]air with code, [c]onnect ip:port, [r]etry, [s]kip (start without a phone)? ")).trim().toLowerCase();
    if (a.startsWith("p")) {
      const md = await mdns();
      const hint = md.pair[0] ? ` [${isAndroid ? md.pair[0].split(":")[1] : md.pair[0]}]` : "";
      let hp = (await rl.question(isAndroid ? `Pairing PORT${hint}: ` : `Pairing ip:port${hint}: `)).trim() || (md.pair[0] ? (isAndroid ? md.pair[0].split(":")[1] : md.pair[0]) : "");
      if (isAndroid && /^\d+$/.test(hp)) hp = selfSerial(hp);
      const code = (await rl.question("Pairing code: ")).trim();
      say((await sh(ADB, ["pair", hp, code], 30000)).out);
      const md2 = await mdns();
      const chint = md2.connect[0] ? ` [${isAndroid ? md2.connect[0].split(":")[1] : md2.connect[0]}]` : "";
      let cp = (await rl.question(isAndroid ? `Wireless debugging PORT (main screen, not the pairing one)${chint}: ` : `Connect ip:port (from the Wireless debugging screen)${chint}: `)).trim() || (md2.connect[0] ? (isAndroid ? md2.connect[0].split(":")[1] : md2.connect[0]) : "");
      if (isAndroid && /^\d+$/.test(cp)) cp = selfSerial(cp);
      if (cp) say((await sh(ADB, ["connect", cp])).out);
    } else if (a.startsWith("c")) {
      let cp = (await rl.question(isAndroid ? "Wireless debugging port (or ip:port): " : "ip:port: ")).trim();
      if (isAndroid && /^\d+$/.test(cp)) cp = selfSerial(cp);
      say((await sh(ADB, ["connect", cp])).out);
    } else if (a.startsWith("s")) return undefined;
  }
}

// ---------- cloudflared quick tunnel ----------
function cfAsset(): string | undefined {
  const a = ({ x64: "amd64", arm64: "arm64", arm: "arm", ia32: "386" } as Record<string, string>)[arch()];
  if (!a) return undefined;
  if (isWin) return a === "arm" ? undefined : `cloudflared-windows-${a === "arm64" ? "amd64" : a}.exe`;
  if (platform() === "darwin") return `cloudflared-darwin-${a === "arm64" ? "arm64" : "amd64"}.tgz`;
  if (platform() === "linux") return `cloudflared-linux-${a}`;
  return undefined;
}

async function cloudflaredPath(): Promise<string | undefined> {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  if ((await sh("cloudflared", ["--version"])).ok) return "cloudflared";
  const bin = join(configDir(), "bin", isWin ? "cloudflared.exe" : "cloudflared");
  if (existsSync(bin)) return bin;
  if (isAndroid) { warn("✗ cloudflared not found. In Termux run: pkg install cloudflared"); return undefined; }
  const asset = cfAsset();
  if (!asset) { warn("✗ No cloudflared build for this platform; install it manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"); return undefined; }
  say(`… downloading cloudflared (${asset}) from GitHub releases`);
  const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`);
  if (!res.ok) { warn(`✗ download failed: HTTP ${res.status}`); return undefined; }
  mkdirSync(dirname(bin), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  if (asset.endsWith(".tgz")) {
    const tgz = bin + ".tgz"; writeFileSync(tgz, buf);
    const r = await sh("tar", ["-xzf", tgz, "-C", dirname(bin)]); rmSync(tgz, { force: true });
    if (!r.ok) { warn(`✗ could not extract cloudflared: ${r.out}`); return undefined; }
  } else writeFileSync(bin, buf);
  if (!isWin) chmodSync(bin, 0o755);
  say(`✓ cloudflared saved to ${bin}`);
  return bin;
}

/** Starts a quick tunnel, resolves with its public https URL; restarts it (new URL) if it dies. */
function startTunnel(cf: string, port: number, onUrl: (url: string) => void): () => void {
  let child: ChildProcess | undefined; let stopped = false;
  const launch = () => {
    child = spawn(cf, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let url: string | undefined, up = false;
    const scan = (d: Buffer) => {
      const t = d.toString(); const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(t);
      if (m && !url) url = m[0];
      if (url && !up && /Registered tunnel connection/.test(t)) { up = true; onUrl(url); }
    };
    child.stdout!.on("data", scan); child.stderr!.on("data", scan);
    const slow = setTimeout(() => { if (!up) warn("! cloudflared has not connected to Cloudflare yet. It needs outbound port 7844 (UDP or TCP); some networks block it. Try another network, or use --funnel (Tailscale)."); }, 45000);
    child.on("exit", (code) => { clearTimeout(slow); if (stopped) return; warn(`! cloudflared exited (${code}); restarting in 5s (the public URL will change)`); setTimeout(launch, 5000); });
  };
  launch();
  return () => { stopped = true; child?.kill(); };
}

// ---------- Tailscale Funnel (stable https://<machine>.<tailnet>.ts.net URL) ----------
async function startFunnel(port: number): Promise<string | undefined> {
  const r = await sh("tailscale", ["funnel", "--bg", String(port)], 20000);
  if (r.out === "ENOENT") { warn("✗ tailscale not installed: https://tailscale.com/download"); return undefined; }
  const enable = /https:\/\/login\.tailscale\.com\/f\/funnel\S*/.exec(r.out);
  if (enable) { warn(`✗ Funnel is not enabled on your tailnet. An admin must enable it: ${enable[0]}`); return undefined; }
  if (!r.ok) { warn(`✗ tailscale funnel failed: ${r.out.split("\n")[0]}`); return undefined; }
  const st = await sh("tailscale", ["status", "--json"]);
  try { const name = JSON.parse(st.out).Self.DNSName.replace(/\.$/, ""); return `https://${name}`; } catch { return /https:\/\/\S+\.ts\.net/.exec(r.out)?.[0]; }
}

// ---------- output ----------
export function connectorInstructions(mcpUrl: string, token: string | undefined, showToken: boolean): string {
  const t = token ? (showToken ? token : `<token from ${tokenFilePath()}>`) : "<no auth>";
  const keyUrl = token ? `${mcpUrl}?key=${showToken ? encodeURIComponent(token) : "<token>"}` : mcpUrl;
  const json = (o: unknown) => JSON.stringify(o, null, 2);
  return `
──────────────── android-use connector ────────────────
MCP URL:  ${mcpUrl}
Header:   Authorization: Bearer ${t}
Key URL:  ${keyUrl}
          (for apps that cannot send headers; the token is part of the URL, so keep that URL private)

Cursor (~/.cursor/mcp.json) · LM Studio (mcp.json) · generic remote MCP:
${json({ mcpServers: { "android-use": { url: mcpUrl, headers: { Authorization: `Bearer ${t}` } } } })}

Claude.ai / Claude Desktop → Settings → Connectors → Add custom connector → URL: the Key URL above
ChatGPT (web) → Settings → Apps → Advanced settings → Developer mode → Create app → URL: the Key URL, Authentication: No authentication
LibreChat (librechat.yaml):
  mcpServers:
    android-use:
      type: streamable-http
      url: ${mcpUrl}
      headers:
        Authorization: "Bearer ${t}"
Open WebUI → Settings → External Tools → + → type "MCP (Streamable HTTP)", URL: ${mcpUrl}, Auth: Bearer, key: the token
───────────────────────────────────────────────────────`;
}

type Args = { serial?: string; pair?: string; code?: string; connect?: string; tunnel: boolean | undefined; funnel: boolean; port: number; host: string; showToken: boolean; interactive: boolean };

export async function runSetup(cmd: "setup" | "start", argv: string[]) {
  const opt = (n: string) => { const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`)); if (i < 0) return undefined; const a = argv[i]; return a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1]; };
  const flag = (n: string) => argv.includes(`--${n}`);
  const saved = loadSaved();
  const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
  const args: Args = {
    serial: opt("serial") || process.env.ADB_SERIAL?.split(",")[0] || (cmd === "start" ? saved.serial : undefined),
    pair: opt("pair"), code: opt("code"), connect: opt("connect"),
    tunnel: flag("tunnel") ? true : flag("no-tunnel") || flag("funnel") ? false : undefined,
    funnel: flag("funnel"),
    port: Number(opt("port") || process.env.PORT || saved.port || 3333),
    host: opt("host") || process.env.HOST || "127.0.0.1",
    showToken: flag("show-token") || (tty && !flag("hide-token")),
    interactive: cmd === "setup" && tty && !flag("yes"),
  };
  say(`android-use ${cmd}`);
  if (!(await checkAdb())) process.exit(1);
  const rl = args.interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const serial = await findPhone(args, rl);
  if (serial) say(`✓ phone: ${serial} (other devices will be refused)`);
  else warn("! starting without a phone; tools will error until one is connected (or use the connect_wifi tool).");
  if (ensureToken()) say(`✓ generated a new auth token → ${tokenFilePath()}`);
  else say(`✓ using existing auth token (${process.env.MCP_AUTH_TOKEN ? "MCP_AUTH_TOKEN" : tokenFilePath()})`);
  if (args.tunnel === undefined) {
    if (rl) args.tunnel = !/^n/i.test((await rl.question("Open a public https URL with a free Cloudflare quick tunnel so web apps (Claude.ai, ChatGPT…) can reach it? [Y/n] ")).trim());
    else args.tunnel = false;
  }
  rl?.close();
  save({ serial: serial || saved.serial, port: args.port || saved.port });

  if (serial && !process.env.ADB_SERIAL) process.env.ADB_SERIAL = serial;
  const token = loadToken();
  const { startHttp } = await import("./http.js");
  const h = await startHttp({
    port: args.port, host: args.host, token,
    allowNoAuth: process.env.MCP_ALLOW_NO_AUTH === "1",
    corsOrigins: (process.env.MCP_CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean),
    trustProxy: args.tunnel || args.funnel || process.env.MCP_TRUST_PROXY === "1",
    httpRatePerMin: Number(process.env.HTTP_RATE_LIMIT_PER_MIN || 600),
    enableSse: process.env.MCP_ENABLE_SSE !== "0",
    jsonResponse: process.env.MCP_JSON_RESPONSE !== "0",
  });
  const localUrl = `http://${args.host === "0.0.0.0" ? "127.0.0.1" : args.host}:${h.port}/mcp`;
  const writeConn = (publicUrl?: string) => writeFileSync(join(configDir(), "connection.json"), JSON.stringify({ localUrl, publicUrl, tokenFile: tokenFilePath(), updated: new Date().toISOString() }, null, 2) + "\n");
  writeConn();
  let stopTunnel = () => {};
  if (isAndroid && !flag("no-wake-lock")) {
    const w = await sh("termux-wake-lock", [], 5000);
    say(w.out === "ENOENT" ? "! termux-wake-lock not found (pkg install termux-tools); Android may pause Termux in the background" : "✓ Termux wake lock acquired (release with: termux-wake-unlock)");
  }
  if (args.funnel) {
    const u = await startFunnel(h.port);
    if (u) {
      writeConn(`${u}/mcp`);
      say(connectorInstructions(`${u}/mcp`, token, args.showToken) + "\nStable URL via Tailscale Funnel (stays the same across restarts). Turn off with: tailscale funnel reset");
    } else say(connectorInstructions(localUrl, token, args.showToken));
  } else if (args.tunnel) {
    const cf = await cloudflaredPath();
    if (cf) {
      say("… opening Cloudflare quick tunnel");
      stopTunnel = startTunnel(cf, h.port, (u) => { writeConn(`${u}/mcp`); say(connectorInstructions(`${u}/mcp`, token, args.showToken)); say("Note: quick-tunnel URLs change every restart. For a stable URL use Tailscale Funnel or a named Cloudflare tunnel (see README)."); });
    }
  } else say(connectorInstructions(localUrl, token, args.showToken) + "\nLocal only. Re-run with --tunnel for a public https URL.");
  say("Press Ctrl+C to stop.");
  const stop = async () => { stopTunnel(); await h.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
