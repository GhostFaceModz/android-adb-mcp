// HTTP-mode + setup tests: start the built server on a random port with a mocked adb. No device needed.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const mock = path.resolve("test/mock-adb.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "android-use-test-"));
const TOKEN = randomBytes(24).toString("hex");

function start(env, args = ["--http", "--port", "0"]) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", ["dist/index.js", ...args], { env: { ...process.env, ADB_PATH: mock, ANDROID_USE_HOME: home, MCP_AUTH_TOKEN: "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let err = "", out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; const m = /listening on http:\/\/[^:]+:(\d+)\/mcp/.exec(err); if (m) setTimeout(() => resolve({ p, port: Number(m[1]), logs: () => err + out }), 100); });
    p.on("exit", (code) => reject(Object.assign(new Error(`exited ${code}`), { code, err })));
  });
}

// Refuses to start without a token.
await assert.rejects(start({}), (e) => e.code === 1 && /Refusing to start/.test(e.err));

const { p, port, logs } = await start({ MCP_AUTH_TOKEN: TOKEN });
const base = `http://127.0.0.1:${port}`;
try {
  assert.equal((await (await fetch(`${base}/health`)).json()).ok, true);

  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
  const hdr = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  // No / wrong token -> 401
  let r = await fetch(`${base}/mcp`, { method: "POST", headers: hdr, body: JSON.stringify(init) });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") || "", /Bearer/);
  r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...hdr, Authorization: "Bearer nope" }, body: JSON.stringify(init) });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/mcp?key=nope`, { method: "POST", headers: hdr, body: JSON.stringify(init) });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${base}/sse`)).status, 401);
  // CORS preflight
  r = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.match(r.headers.get("access-control-allow-headers"), /Authorization/);

  // Bearer token: initialize + tools/list + call
  const c = new Client({ name: "http-test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  assert.equal(c.getServerVersion().name, "android-use");
  const names = (await c.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes("list_devices") && names.includes("screenshot") && !names.includes("shell"));
  assert.match((await c.callTool({ name: "list_devices", arguments: {} })).content[0].text, /emulator-5554/);
  assert.equal((await c.callTool({ name: "screenshot", arguments: {} })).content[0].type, "image");
  await c.close();

  // Token via ?key=
  const c2 = new Client({ name: "http-test-q", version: "0" });
  await c2.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?key=${TOKEN}`)));
  assert.ok((await c2.listTools()).tools.length > 5);
  await c2.close();

  // Legacy SSE with ?key=
  const c3 = new Client({ name: "sse-test", version: "0" });
  await c3.connect(new SSEClientTransport(new URL(`${base}/sse?key=${TOKEN}`)));
  assert.ok((await c3.listTools()).tools.some((t) => t.name === "tap"));
  await c3.close();

  // Unknown session -> 404, non-initialize without session -> 400
  const list = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...hdr, Authorization: `Bearer ${TOKEN}`, "Mcp-Session-Id": "bogus" }, body: list });
  assert.equal(r.status, 404);
  r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...hdr, Authorization: `Bearer ${TOKEN}` }, body: list });
  assert.equal(r.status, 400);

  assert.ok(!logs().includes(TOKEN), "token leaked to logs");
} finally { p.kill(); }

// `start` (non-interactive setup): generates a private token file, locks to the phone, never prints the token when not a TTY.
const s = await start({}, ["start", "--yes", "--no-tunnel", "--port", "0"]);
try {
  const tf = path.join(home, "token");
  assert.ok(fs.existsSync(tf), "token file created");
  if (process.platform !== "win32") assert.equal(fs.statSync(tf).mode & 0o777, 0o600);
  const tok = fs.readFileSync(tf, "utf8").trim();
  assert.ok(tok.length >= 40);
  assert.match(s.logs(), /emulator-5554/);
  assert.ok(!s.logs().includes(tok), "token printed in non-interactive mode");
  const c = new Client({ name: "setup-test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${s.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tok}` } } }));
  assert.match((await c.callTool({ name: "list_devices", arguments: {} })).content[0].text, /emulator-5554/);
  await c.close();
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).serial, "emulator-5554");
} finally { s.p.kill(); fs.rmSync(home, { recursive: true, force: true }); }
// Phone-only (Termux) flow: bare ports map to 127.0.0.1:<port>, pairing + connect happen, serial is remembered.
const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "android-use-test-"));
const wstate = path.join(home2, "wireless");
const logf = path.join(home2, "adb.log");
const t = await start({ ANDROID_USE_HOME: home2, TERMUX_VERSION: "0.118", MOCK_WIRELESS: wstate, MOCK_ADB_LOG: logf, PATH: `${path.dirname(mock)}:${process.env.PATH}` },
  ["start", "--yes", "--no-tunnel", "--no-wake-lock", "--port", "0", "--pair", "37099", "--code", "123456", "--connect", "41235"]);
try {
  const adbCalls = fs.readFileSync(logf, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(adbCalls.some((c) => c.join(" ") === "pair 127.0.0.1:37099 123456"), "self-pair on 127.0.0.1");
  assert.ok(adbCalls.some((c) => c.join(" ") === "connect 127.0.0.1:41235"), "self-connect on 127.0.0.1");
  assert.equal(JSON.parse(fs.readFileSync(path.join(home2, "config.json"), "utf8")).serial, "127.0.0.1:41235");
} finally { t.p.kill(); }
// After a "reboot" the saved port is dead: start rediscovers the new port via mDNS.
fs.rmSync(wstate);
const t2 = await start({ ANDROID_USE_HOME: home2, TERMUX_VERSION: "0.118", MOCK_WIRELESS: wstate, ADB_SERIAL: "" }, ["start", "--yes", "--no-tunnel", "--no-wake-lock", "--port", "0", "--serial", "127.0.0.1:40000"]);
try {
  assert.match(t2.logs(), /port changed; now 127\.0\.0\.1:41235/);
  assert.match(t2.logs(), /phone: 127\.0\.0\.1:41235/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home2, "config.json"), "utf8")).serial, "127.0.0.1:41235");
} finally { t2.p.kill(); fs.rmSync(home2, { recursive: true, force: true }); }
console.log("http test OK");
