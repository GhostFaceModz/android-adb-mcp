#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { run, log, shQuote, encodeInputText, KEYS, parseUiDump, parseDevices, parseCurrentApp, isSensitive } from "./adb.js";

const ALLOWLIST = (process.env.ADB_SERIAL || "").split(",").map((s) => s.trim()).filter(Boolean);
const ALLOW_SHELL = process.env.ALLOW_SHELL === "1";
const ALLOW_SENSITIVE = process.env.ALLOW_SENSITIVE === "1";
const RATE = Number(process.env.RATE_LIMIT_PER_MIN || 120);
const stamps: number[] = [];

function rateLimit() {
  const now = Date.now();
  while (stamps.length && now - stamps[0] > 60000) stamps.shift();
  if (stamps.length >= RATE) throw new Error(`Rate limit exceeded (${RATE}/min). Set RATE_LIMIT_PER_MIN to change.`);
  stamps.push(now);
}

function serialArgs(serial?: string): string[] {
  const s = serial || ALLOWLIST[0];
  if (ALLOWLIST.length && (!s || !ALLOWLIST.includes(s))) throw new Error(`Device ${s} is not in ADB_SERIAL allowlist (${ALLOWLIST.join(", ")})`);
  return s ? ["-s", s] : [];
}

const adb = (serial: string | undefined, args: string[], binary = false) => run([...serialArgs(serial), ...args], { binary });
const sh = async (serial: string | undefined, cmd: string) => (await adb(serial, ["shell", cmd])).toString();

async function currentApp(serial?: string) {
  return parseCurrentApp(await sh(serial, "dumpsys window"));
}
async function guard(serial?: string, pkg?: string) {
  if (ALLOW_SENSITIVE) return;
  const target = pkg ?? (await currentApp(serial));
  if (isSensitive(target)) throw new Error(`Refusing: '${target}' is on the sensitive-app list (banking/payments/messaging). The user can set ALLOW_SENSITIVE=1 to override.`);
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const serial = z.string().optional().describe("Device serial (optional; defaults to first ADB_SERIAL entry or the only connected device)");

const server = new McpServer({ name: "android-adb-mcp", version: "0.1.0" });

function tool<S extends z.ZodRawShape>(name: string, desc: string, shape: S, fn: (a: z.objectOutputType<S, z.ZodTypeAny>) => Promise<any>) {
  server.tool(name, desc, shape, (async (a: any) => {
    const safe = { ...a }; if (name === "type_text") safe.text = `<${String(a.text).length} chars>`;
    log(`tool ${name}`, JSON.stringify(safe));
    try { rateLimit(); return await fn(a); }
    catch (e: any) { log(`tool ${name} error: ${e.message}`); return { ...text(`Error: ${e.message}`), isError: true }; }
  }) as any);
}

tool("list_devices", "List connected ADB devices (filtered by ADB_SERIAL allowlist if set)", {}, async () => {
  let d = parseDevices((await run(["devices", "-l"])).toString());
  if (ALLOWLIST.length) d = d.filter((x) => ALLOWLIST.includes(x.serial));
  return text(JSON.stringify(d, null, 1) || "[]");
});

tool("connect_wifi", "Connect to a device over Wi-Fi. For Android 11+ wireless debugging, pass pairing_code and pair_port (from 'Pair device with pairing code') to pair first.",
  { host: z.string(), port: z.number().int().default(5555), pairing_code: z.string().optional(), pair_port: z.number().int().optional() },
  async ({ host, port, pairing_code, pair_port }) => {
    if (!/^[\w.:-]+$/.test(host)) throw new Error("Invalid host");
    let out = "";
    if (pairing_code) {
      if (!pair_port) throw new Error("pair_port is required with pairing_code");
      out += (await run(["pair", `${host}:${pair_port}`, pairing_code])).toString();
    }
    if (ALLOWLIST.length && !ALLOWLIST.includes(`${host}:${port}`)) out += `\nWarning: ${host}:${port} is not in ADB_SERIAL; other tools will refuse it.\n`;
    out += (await run(["connect", `${host}:${port}`])).toString();
    return text(out.trim());
  });

tool("screenshot", "Take a screenshot (PNG)", { serial }, async ({ serial }) => {
  await guard(serial);
  const png = await adb(serial, ["exec-out", "screencap", "-p"], true);
  return { content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }] };
});

tool("get_screen_size", "Get screen resolution in pixels", { serial }, async ({ serial }) => text((await sh(serial, "wm size")).trim()));

const xy = { x: z.number().int().min(0), y: z.number().int().min(0) };
tool("tap", "Tap at pixel coordinates", { serial, ...xy }, async ({ serial, x, y }) => {
  await guard(serial); await sh(serial, `input tap ${x} ${y}`); return text(`tapped ${x},${y}`);
});
tool("swipe", "Swipe from (x1,y1) to (x2,y2) over ms milliseconds", { serial, x1: z.number().int(), y1: z.number().int(), x2: z.number().int(), y2: z.number().int(), ms: z.number().int().min(1).max(10000).default(300) },
  async ({ serial, x1, y1, x2, y2, ms }) => { await guard(serial); await sh(serial, `input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`); return text("swiped"); });
tool("long_press", "Long-press at coordinates", { serial, ...xy, ms: z.number().int().min(100).max(10000).default(800) },
  async ({ serial, x, y, ms }) => { await guard(serial); await sh(serial, `input swipe ${x} ${y} ${x} ${y} ${ms}`); return text(`long-pressed ${x},${y}`); });
tool("type_text", "Type text into the focused field (printable ASCII)", { serial, text: z.string().max(1000) }, async ({ serial, text: t }) => {
  await guard(serial); await sh(serial, `input text ${encodeInputText(t)}`); return text(`typed ${t.length} chars`);
});
tool("key_event", `Send a key event. Names: ${Object.keys(KEYS).join(", ")}; or a numeric keycode`, { serial, key: z.string() }, async ({ serial, key }) => {
  const code = KEYS[key.toLowerCase()] ?? (/^\d+$/.test(key) ? Number(key) : undefined);
  if (code === undefined) throw new Error(`Unknown key '${key}'`);
  if (code !== 3 && code !== 4 && code !== 187 && code !== 26) await guard(serial); // navigation away is always allowed
  await sh(serial, `input keyevent ${code}`); return text(`key ${key} (${code})`);
});

const pkgRe = /^[A-Za-z][\w]*(\.[\w]+)+$/;
tool("open_app", "Launch an app by package name", { serial, package: z.string() }, async ({ serial, package: p }) => {
  if (!pkgRe.test(p)) throw new Error("Invalid package name");
  await guard(serial, p);
  return text((await sh(serial, `monkey -p ${p} -c android.intent.category.LAUNCHER 1`)).trim());
});
tool("list_apps", "List installed packages (third-party by default)", { serial, include_system: z.boolean().default(false), filter: z.string().optional() },
  async ({ serial, include_system, filter }) => {
    let pk = (await sh(serial, `pm list packages${include_system ? "" : " -3"}`)).split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(Boolean).sort();
    if (filter) pk = pk.filter((p) => p.includes(filter));
    return text(pk.join("\n"));
  });
tool("current_app", "Get the foreground app package", { serial }, async ({ serial }) => text((await currentApp(serial)) ?? "unknown"));

async function dump(serial?: string) {
  await guard(serial);
  await sh(serial, "uiautomator dump /sdcard/window_dump.xml");
  return parseUiDump((await adb(serial, ["exec-out", "cat", "/sdcard/window_dump.xml"])).toString());
}
tool("ui_dump", "Dump the UI hierarchy as a compact list of clickable/labelled elements with bounds and center coordinates", { serial }, async ({ serial }) => {
  const els = await dump(serial);
  return text(els.map((e) => `#${e.i} ${e.cls}${e.clickable ? " [clickable]" : ""} text="${e.text}"${e.desc ? ` desc="${e.desc}"` : ""}${e.id ? ` id=${e.id}` : ""} center=${e.center.join(",")}`).join("\n") || "(no elements)");
});
tool("tap_element", "Find an element by text/content-desc (substring, case-insensitive) or resource-id and tap its center", { serial, text: z.string().optional(), resource_id: z.string().optional(), index: z.number().int().min(0).default(0).describe("Which match to tap if several") },
  async ({ serial, text: t, resource_id, index }) => {
    if (!t && !resource_id) throw new Error("Provide text or resource_id");
    const els = await dump(serial);
    const m = els.filter((e) => resource_id ? e.id === resource_id || e.id.endsWith(`:id/${resource_id}`) : (e.text + "\n" + e.desc).toLowerCase().includes(t!.toLowerCase()));
    const e = m[index];
    if (!e) throw new Error(`No matching element (found ${m.length})`);
    await sh(serial, `input tap ${e.center[0]} ${e.center[1]}`);
    return text(`tapped #${e.i} "${e.text || e.desc || e.id}" at ${e.center.join(",")} (${m.length} matches)`);
  });

if (ALLOW_SHELL) {
  tool("shell", "Run an arbitrary adb shell command (enabled via ALLOW_SHELL=1). Dangerous.", { serial, command: z.string().max(2000) }, async ({ serial, command }) => text(await sh(serial, command)));
}

log(`starting; allowlist=${ALLOWLIST.join(",") || "(any)"} shell=${ALLOW_SHELL} sensitive=${ALLOW_SENSITIVE} rate=${RATE}/min`);
await server.connect(new StdioServerTransport());
