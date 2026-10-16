import { execFile } from "node:child_process";

export const ADB = process.env.ADB_PATH || "adb";
export const log = (...a: unknown[]) => console.error(`[android-adb-mcp ${new Date().toISOString()}]`, ...a);

export function run(args: string[], opts: { binary?: boolean; timeoutMs?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`adb ${args.join(" ")} failed: ${stderr?.toString().trim() || err.message}`));
      else resolve(stdout);
    });
  });
}

/** Quote a string for the device-side /system/bin/sh. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Encode text for `input text`: spaces become %s, then shell-quoted. */
export function encodeInputText(text: string): string {
  if (/[^\x20-\x7e]/.test(text)) throw new Error("type_text supports printable ASCII only (adb `input text` limitation)");
  return shQuote(text.replace(/%/g, "\\%").replace(/ /g, "%s"));
}

export const KEYS: Record<string, number> = {
  home: 3, back: 4, call: 5, endcall: 6, up: 19, down: 20, left: 21, right: 22, center: 23,
  volume_up: 24, volume_down: 25, power: 26, camera: 27, tab: 61, enter: 66, delete: 67,
  menu: 82, search: 84, play_pause: 85, mute: 164, recents: 187, app_switch: 187, wakeup: 224, sleep: 223,
};

export interface UiElement { i: number; text: string; desc: string; id: string; cls: string; clickable: boolean; bounds: [number, number, number, number]; center: [number, number]; }

export function parseUiDump(xml: string): UiElement[] {
  const out: UiElement[] = [];
  const attr = (n: string, k: string) => (n.match(new RegExp(`\\s${k}="([^"]*)"`)) || [])[1] ?? "";
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const n = m[0];
    const b = attr(n, "bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    const text = unesc(attr(n, "text")), desc = unesc(attr(n, "content-desc")), id = attr(n, "resource-id");
    const clickable = attr(n, "clickable") === "true" || attr(n, "long-clickable") === "true";
    if (!clickable && !text && !desc) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 <= x1 || y2 <= y1) continue;
    out.push({ i: out.length, text, desc, id, cls: attr(n, "class").split(".").pop() || "", clickable, bounds: [x1, y1, x2, y2], center: [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)] });
  }
  return out;
}

export function parseDevices(out: string) {
  return out.split("\n").slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [serial, state, ...rest] = l.split(/\s+/);
    return { serial, state, info: rest.join(" ") };
  });
}

export function parseCurrentApp(dumpsys: string): string | null {
  const m = dumpsys.match(/mCurrentFocus=Window\{[^}]*?\s([\w.]+)\/[^\s}]+/) || dumpsys.match(/mFocusedApp=.*?\s([\w.]+)\/[^\s}]+/);
  return m ? m[1] : null;
}

const DEFAULT_SENSITIVE = [
  "com.google.android.apps.walletnfcrel", "com.samsung.android.spay", "com.samsung.android.samsungpay.gear",
  "com.paypal.android.p2pmobile", "com.venmo", "com.squareup.cash", "com.zellepay.zelle", "com.coinbase.android",
  "com.whatsapp", "org.telegram.messenger", "org.thoughtcrime.securesms", "com.google.android.apps.messaging",
  "com.samsung.android.messaging", "com.facebook.orca", "com.android.vending",
];
const SENSITIVE_KEYWORDS = /(bank|wallet|pay|finance|crypto|authenticator|messag|signal|keepass|bitwarden|1password)/i;

export function isSensitive(pkg: string | null | undefined): boolean {
  if (!pkg) return false;
  const extra = (process.env.SENSITIVE_PACKAGES || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_SENSITIVE, ...extra].includes(pkg) || SENSITIVE_KEYWORDS.test(pkg);
}
