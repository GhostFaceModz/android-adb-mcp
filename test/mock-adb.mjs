#!/usr/bin/env node
// Fake `adb` for tests. Logs argv to $MOCK_ADB_LOG and returns canned output.
import fs from "node:fs";
const a = process.argv.slice(2);
if (process.env.MOCK_ADB_LOG) fs.appendFileSync(process.env.MOCK_ADB_LOG, JSON.stringify(a) + "\n");
const args = a[0] === "-s" ? a.slice(2) : a;
const cmd = args.join(" ");
const fg = process.env.MOCK_FG || "com.android.launcher3";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
if (cmd.startsWith("devices")) process.stdout.write("List of devices attached\nemulator-5554 device product:x model:Pixel\n");
else if (cmd === "exec-out screencap -p") process.stdout.write(PNG);
else if (cmd === "shell dumpsys window") process.stdout.write(`  mCurrentFocus=Window{abc u0 ${fg}/.Main}\n`);
else if (cmd === "shell wm size") process.stdout.write("Physical size: 1080x2340\n");
else if (cmd.startsWith("shell pm list packages")) process.stdout.write("package:com.example.app\npackage:com.whatsapp\n");
else if (cmd === "exec-out cat /sdcard/window_dump.xml") process.stdout.write(`<?xml version='1.0'?><hierarchy><node text="" resource-id="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,2340]"><node text="Sign &amp; in" resource-id="com.example:id/login" class="android.widget.Button" content-desc="" clickable="true" bounds="[100,200][300,260]" /></node></hierarchy>`);
else if (cmd.startsWith("connect")) process.stdout.write(`connected to ${args[1]}\n`);
else if (cmd.startsWith("pair")) process.stdout.write(`Successfully paired to ${args[1]}\n`);
