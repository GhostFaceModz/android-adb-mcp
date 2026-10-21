#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { log } from "./adb.js";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`)); if (i < 0) return undefined; const a = argv[i]; return a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1]; };
const VERSION: string = (() => { try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; } catch { return "0.0.0"; } })();

if (flag("version") || argv[0] === "version") { console.log(VERSION); process.exit(0); }
if (flag("help") || argv[0] === "help" || argv[0] === "-h") {
  console.log(`android-use v${VERSION} — MCP server for controlling an Android phone over ADB

Usage:
  android-use                 stdio transport (default; for local MCP clients like Claude Desktop/Cursor)
  android-use setup           guided setup: check adb, find your phone, create a token, start HTTP,
                              optionally open a public https URL, print copy-paste connector configs
  android-use start           non-interactive start using the saved setup (add --tunnel for a public URL)
  android-use --http          plain Streamable HTTP server on http://HOST:PORT/mcp (+ /sse, /health)

setup/start options:
  --serial <serial>           which device to lock to (default: the only connected one)
  --pair <ip:port> --code <c> pair over Wireless debugging first
  --connect <ip:port>         adb connect first
  --tunnel / --no-tunnel      open (or not) a Cloudflare quick tunnel (cloudflared auto-downloaded)
  --show-token / --hide-token print the real token in configs (default: only on an interactive terminal)
  --yes                       don't ask questions

Options (flag or env):
  --port / PORT               default 3333
  --host / HOST               default 127.0.0.1 (0.0.0.0 in Docker)
  MCP_TRANSPORT=http          same as --http
  MCP_AUTH_TOKEN              bearer token clients must send (HTTP mode refuses to start without one)
  MCP_AUTH_TOKEN_FILE         read the token from this file (default: <config dir>/token)
  MCP_ALLOW_NO_AUTH=1         allow HTTP mode without a token (local testing only)
  MCP_CORS_ORIGINS            comma list of allowed browser origins (default *)
  MCP_TRUST_PROXY=1           use CF-Connecting-IP / X-Forwarded-For for per-client rate limits
  HTTP_RATE_LIMIT_PER_MIN     per-client HTTP request limit (default 600)
  MCP_ENABLE_SSE=0            disable the legacy /sse endpoint
  MCP_JSON_RESPONSE=0         stream POST responses as SSE instead of plain JSON
  ADB_PATH, ADB_SERIAL, ALLOW_SHELL, ALLOW_SENSITIVE, SENSITIVE_PACKAGES, RATE_LIMIT_PER_MIN  (see README)`);
  process.exit(0);
}

if (argv[0] === "setup" || argv[0] === "start") {
  const { runSetup } = await import("./setup.js");
  try { await runSetup(argv[0], argv.slice(1)); } catch (e: any) { console.error(`✗ ${e.message}`); process.exit(1); }
} else {
  const { createServer, CONFIG } = await import("./server.js");
  log(`android-use v${VERSION} starting; allowlist=${CONFIG.allowlist.join(",") || "(any)"} shell=${CONFIG.allowShell} sensitive=${CONFIG.allowSensitive} rate=${CONFIG.rate}/min`);
  const mode = (process.env.MCP_TRANSPORT || "").toLowerCase();
  if (flag("http") || mode === "http" || mode === "streamable-http") {
    const { startHttp } = await import("./http.js");
    const { loadToken } = await import("./setup.js");
    try {
      const h = await startHttp({
        port: Number(opt("port") ?? process.env.PORT ?? 3333),
        host: opt("host") || process.env.HOST || "127.0.0.1",
        token: loadToken(),
        allowNoAuth: process.env.MCP_ALLOW_NO_AUTH === "1",
        corsOrigins: (process.env.MCP_CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean),
        trustProxy: process.env.MCP_TRUST_PROXY === "1",
        httpRatePerMin: Number(process.env.HTTP_RATE_LIMIT_PER_MIN || 600),
        enableSse: process.env.MCP_ENABLE_SSE !== "0",
        jsonResponse: process.env.MCP_JSON_RESPONSE !== "0",
      });
      const stop = async () => { await h.close(); process.exit(0); };
      process.on("SIGINT", stop); process.on("SIGTERM", stop);
    } catch (e: any) { log(`fatal: ${e.message}`); process.exit(1); }
  } else {
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    await createServer().connect(new StdioServerTransport());
  }
}
