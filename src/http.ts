import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer, VERSION } from "./server.js";
import { log } from "./adb.js";

export interface HttpOptions {
  port: number;
  host: string;
  token?: string;
  allowNoAuth?: boolean;
  corsOrigins?: string[]; // ["*"] = any
  trustProxy?: boolean;
  httpRatePerMin?: number;
  sessionIdleMs?: number;
  maxSessions?: number;
  enableSse?: boolean;
  /** Reply to POSTs with plain JSON instead of an SSE stream (works through more proxies/tunnels). Default true. */
  jsonResponse?: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
export const isLoopback = (h: string) => LOOPBACK.has(h) || h.startsWith("127.");

/** Constant-time token compare (hash both sides so lengths always match). */
export function tokenMatches(given: string | undefined | null, expected: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("Payload too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString("utf8");
      if (!s) return resolve(undefined);
      try { resolve(JSON.parse(s)); } catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const rpcError = (res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) =>
  json(res, status, { jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null }, headers);

export function startHttp(opts: HttpOptions) {
  const { port, host, token } = opts;
  if (!token && !opts.allowNoAuth) {
    throw new Error("Refusing to start HTTP mode without MCP_AUTH_TOKEN (or MCP_AUTH_TOKEN_FILE). Run `android-use setup` to generate one, or set MCP_ALLOW_NO_AUTH=1 to override (loopback/testing only).");
  }
  if (!token) log(`WARNING: HTTP auth DISABLED (MCP_ALLOW_NO_AUTH=1)${isLoopback(host) ? "" : ` while bound to ${host} — anyone who can reach this port controls the phone`}`);
  if (token && token.length < 24) log("WARNING: MCP_AUTH_TOKEN is short; use at least 32 random characters (`android-use setup` generates one)");

  const cors = opts.corsOrigins ?? ["*"];
  const ratePerMin = opts.httpRatePerMin ?? 600;
  const idleMs = opts.sessionIdleMs ?? 30 * 60_000;
  const maxSessions = opts.maxSessions ?? 50;

  type Sess = { transport: StreamableHTTPServerTransport | SSEServerTransport; last: number; close: () => Promise<void> };
  const sessions = new Map<string, Sess>();
  const hits = new Map<string, number[]>();
  const authFails = new Map<string, number[]>();

  const clientIp = (req: IncomingMessage) => {
    if (opts.trustProxy) {
      const h = (req.headers["cf-connecting-ip"] as string) || (req.headers["x-forwarded-for"] as string) || "";
      const ip = h.split(",")[0].trim(); if (ip) return ip;
    }
    return req.socket.remoteAddress || "?";
  };
  const window = (m: Map<string, number[]>, k: string, max: number) => {
    const now = Date.now(); const arr = (m.get(k) || []).filter((t) => now - t < 60_000);
    m.set(k, arr); if (arr.length >= max) return false; arr.push(now); return true;
  };

  function setCors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (!origin) return;
    if (cors.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
    else if (cors.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
    else return;
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, X-API-Key");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  /** Returns how the request authenticated ("header" | "query" | "none") or null if rejected. */
  function authenticate(req: IncomingMessage, url: URL): "header" | "query" | "none" | null {
    if (!token) return "none";
    const auth = req.headers.authorization;
    const bearer = auth && /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
    if (bearer && tokenMatches(bearer, token)) return "header";
    const xkey = req.headers["x-api-key"];
    if (typeof xkey === "string" && tokenMatches(xkey, token)) return "header";
    const q = url.searchParams.get("key");
    if (q && tokenMatches(q, token)) return "query";
    return null;
  }

  // Sweep idle sessions.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.last > idleMs) { sessions.delete(id); s.close().catch(() => {}); log(`session ${id.slice(0, 8)} expired`); }
  }, 60_000);
  sweeper.unref();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://local");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ip = clientIp(req);
    setCors(req, res);
    try {
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      if (path === "/health" || path === "/healthz") return json(res, 200, { ok: true, name: "android-use", version: VERSION, sessions: sessions.size });
      if (path === "/") return json(res, 200, { name: "android-use", version: VERSION, mcp: "/mcp", sse: opts.enableSse === false ? undefined : "/sse", health: "/health" });

      const isMcp = path === "/mcp", isSse = path === "/sse", isMsg = path === "/messages" || path === "/message";
      if (!isMcp && !((isSse || isMsg) && opts.enableSse !== false)) return json(res, 404, { error: "Not found" });

      if (!window(hits, ip, ratePerMin)) return rpcError(res, 429, "Too many requests", { "Retry-After": "60" });
      if ((authFails.get(ip) || []).filter((t) => Date.now() - t < 60_000).length >= 10) return rpcError(res, 429, "Too many failed auth attempts", { "Retry-After": "60" });
      const how = authenticate(req, url);
      if (!how) {
        window(authFails, ip, 1e9);
        log(`401 ${req.method} ${path} from ${ip}`);
        return rpcError(res, 401, "Unauthorized: send 'Authorization: Bearer <token>' (or ?key=<token>)", { "WWW-Authenticate": 'Bearer realm="android-use"' });
      }

      // ---- Streamable HTTP (current spec) ----
      if (isMcp) {
        const sid = req.headers["mcp-session-id"] as string | undefined;
        if (req.method === "POST") {
          const body = await readBody(req);
          let s = sid ? sessions.get(sid) : undefined;
          if (sid && !s) return rpcError(res, 404, "Session not found (expired or server restarted); re-initialize");
          if (s && !(s.transport instanceof StreamableHTTPServerTransport)) return rpcError(res, 400, "Session belongs to SSE transport");
          if (!s) {
            const isInit = Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body);
            if (!isInit) return rpcError(res, 400, "Bad Request: no valid session ID provided (send initialize first)");
            if (sessions.size >= maxSessions) return rpcError(res, 503, "Too many sessions");
            const mcp = createServer();
            const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              enableJsonResponse: opts.jsonResponse !== false,
              onsessioninitialized: (id) => { sessions.set(id, { transport, last: Date.now(), close: async () => { await transport.close(); await mcp.close(); } }); log(`session ${id.slice(0, 8)} opened (${ip})`); },
            });
            transport.onclose = () => { const id = transport.sessionId; if (id && sessions.delete(id)) log(`session ${id.slice(0, 8)} closed`); };
            await mcp.connect(transport);
            return await transport.handleRequest(req, res, body);
          }
          s.last = Date.now();
          return await (s.transport as StreamableHTTPServerTransport).handleRequest(req, res, body);
        }
        if (req.method === "GET" || req.method === "DELETE") {
          const s = sid ? sessions.get(sid) : undefined;
          if (!s || !(s.transport instanceof StreamableHTTPServerTransport)) return rpcError(res, sid ? 404 : 400, sid ? "Session not found" : "Missing Mcp-Session-Id");
          s.last = Date.now();
          return await s.transport.handleRequest(req, res);
        }
        return rpcError(res, 405, "Method not allowed", { Allow: "GET, POST, DELETE, OPTIONS" });
      }

      // ---- Legacy HTTP+SSE (2024-11-05 clients) ----
      if (isSse) {
        if (req.method !== "GET") return rpcError(res, 405, "Method not allowed");
        if (sessions.size >= maxSessions) return rpcError(res, 503, "Too many sessions");
        // If the client could only authenticate via ?key=, it needs the key on the POST URL too.
        const endpoint = how === "query" ? `/messages?key=${encodeURIComponent(url.searchParams.get("key")!)}` : "/messages";
        const transport = new SSEServerTransport(endpoint, res);
        const mcp = createServer();
        const id = transport.sessionId;
        sessions.set(id, { transport, last: Date.now(), close: async () => { await transport.close(); await mcp.close(); } });
        const ka = setInterval(() => { try { res.write(": keepalive\n\n"); } catch {} }, 25_000);
        res.on("close", () => { clearInterval(ka); if (sessions.delete(id)) log(`sse session ${id.slice(0, 8)} closed`); mcp.close().catch(() => {}); });
        log(`sse session ${id.slice(0, 8)} opened (${ip})`);
        await mcp.connect(transport);
        return;
      }
      if (isMsg) {
        if (req.method !== "POST") return rpcError(res, 405, "Method not allowed");
        const s = sessions.get(url.searchParams.get("sessionId") || "");
        if (!s || !(s.transport instanceof SSEServerTransport)) return rpcError(res, 404, "Session not found");
        s.last = Date.now();
        return await s.transport.handlePostMessage(req, res, await readBody(req));
      }
    } catch (e: any) {
      log(`http error ${req.method} ${path}: ${e.message}`);
      rpcError(res, e.status || 500, e.status ? e.message : "Internal server error");
    }
  });

  return new Promise<{ close: () => Promise<void>; port: number }>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      log(`HTTP transport listening on http://${host.includes(":") ? `[${host}]` : host}:${p}/mcp (auth=${token ? "bearer" : "OFF"}, sse=${opts.enableSse !== false}, cors=${cors.join(",")})`);
      resolve({
        port: p,
        close: async () => {
          clearInterval(sweeper);
          await Promise.all([...sessions.values()].map((s) => s.close().catch(() => {})));
          sessions.clear();
          await new Promise<void>((r) => httpServer.close(() => r()));
        },
      });
    });
  });
}
