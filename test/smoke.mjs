// Smoke test: drives the built server over stdio with a mocked adb. No device needed.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { encodeInputText, parseCurrentApp, isSensitive } from "../dist/adb.js";

const logFile = path.join(os.tmpdir(), `mockadb-${process.pid}.log`);
const mock = path.resolve("test/mock-adb.mjs");
async function start(env = {}) {
  const t = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env, ADB_PATH: mock, MOCK_ADB_LOG: logFile, ...env }, stderr: "ignore" });
  const c = new Client({ name: "smoke", version: "0" }); await c.connect(t); return c;
}
const txt = (r) => r.content[0].text;
const calls = () => fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// unit checks
assert.equal(encodeInputText("hi there"), "'hi%sthere'");
assert.equal(encodeInputText("it's; rm -rf"), "'it'\\''s;%srm%s-rf'");
assert.throws(() => encodeInputText("héllo"));
assert.equal(parseCurrentApp("mCurrentFocus=Window{1 u0 com.foo.bar/com.foo.Main}"), "com.foo.bar");
assert.ok(isSensitive("com.whatsapp") && isSensitive("com.chase.sig.android.bank") && !isSensitive("com.example.app"));

let c = await start();
const names = (await c.listTools()).tools.map((t) => t.name);
assert.ok(!names.includes("shell"), "shell must be off by default");
for (const n of ["list_devices","connect_wifi","screenshot","tap","swipe","long_press","type_text","key_event","open_app","list_apps","current_app","ui_dump","tap_element","get_screen_size"]) assert.ok(names.includes(n), n);
assert.match(txt(await c.callTool({ name: "list_devices", arguments: {} })), /emulator-5554/);
const shot = await c.callTool({ name: "screenshot", arguments: {} }); assert.equal(shot.content[0].type, "image");
assert.match(txt(await c.callTool({ name: "get_screen_size", arguments: {} })), /1080x2340/);
await c.callTool({ name: "type_text", arguments: { text: "hello world" } });
assert.deepEqual(calls().at(-1), ["shell", "input text 'hello%sworld'"]);
await c.callTool({ name: "key_event", arguments: { key: "home" } });
assert.deepEqual(calls().at(-1), ["shell", "input keyevent 3"]);
assert.match(txt(await c.callTool({ name: "ui_dump", arguments: {} })), /Sign & in.*center=200,230/);
await c.callTool({ name: "tap_element", arguments: { resource_id: "login" } });
assert.deepEqual(calls().at(-1), ["shell", "input tap 200 230"]);
const r = await c.callTool({ name: "open_app", arguments: { package: "com.whatsapp" } });
assert.ok(r.isError && /sensitive/.test(txt(r)), "sensitive open_app refused");
assert.match(txt(await c.callTool({ name: "connect_wifi", arguments: { host: "192.168.1.5", port: 37000, pairing_code: "123456", pair_port: 41000 } })), /connected to 192.168.1.5:37000/);
await c.close();

c = await start({ MOCK_FG: "com.paypal.android.p2pmobile" });
assert.ok((await c.callTool({ name: "tap", arguments: { x: 1, y: 1 } })).isError, "tap in sensitive fg refused");
await c.close();

c = await start({ ADB_SERIAL: "R5CT00000", ALLOW_SHELL: "1", RATE_LIMIT_PER_MIN: "3" });
assert.ok((await c.listTools()).tools.some((t) => t.name === "shell"));
await c.callTool({ name: "tap", arguments: { x: 5, y: 6 } });
assert.deepEqual(calls().at(-1).slice(0, 2), ["-s", "R5CT00000"]);
await c.callTool({ name: "current_app", arguments: {} }); await c.callTool({ name: "current_app", arguments: {} });
const lim = await c.callTool({ name: "current_app", arguments: {} });
assert.ok(lim.isError && /Rate limit/.test(txt(lim)));
const bad = await start({ ADB_SERIAL: "R5CT00000" });
assert.match(txt(await bad.callTool({ name: "tap", arguments: { serial: "other", x: 1, y: 1 } })), /allowlist/);
await bad.close(); await c.close();
fs.rmSync(logFile, { force: true });
console.log("smoke test OK");
