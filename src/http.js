// Standalone Node HTTP server for the remote MCP endpoint.
// POST /mcp (alias /api/mcp) — streamable HTTP, stateless, read-only.
import http from "node:http";
import { handleMcpRequest } from "./web-handler.js";

const RATE = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const buckets = new Map();
function allow(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: RATE, at: now };
  b.tokens = Math.min(RATE, b.tokens + ((now - b.at) / 60000) * RATE);
  b.at = now;
  if (b.tokens < 1) { buckets.set(ip, b); return false; }
  b.tokens -= 1; buckets.set(ip, b);
  return true;
}

export function startHttpServer({ port = Number(process.env.PORT || 3000), host = process.env.HOST || "0.0.0.0" } = {}) {
  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (url.pathname !== "/mcp" && url.pathname !== "/api/mcp") {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Not found. MCP endpoint: POST /mcp");
      }
      const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
      if (!allow(ip)) {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "10" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Rate limited" }, id: null }));
      }
      const chunks = [];
      for await (const c of req) {
        chunks.push(c);
        if (chunks.reduce((n, x) => n + x.length, 0) > 1_000_000) { res.writeHead(413); return res.end(); }
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      const webReq = new Request(url, {
        method: req.method, headers,
        body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const webRes = await handleMcpRequest(webReq);
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    }
  });
  return new Promise((resolve) => srv.listen(port, host, () => resolve(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer().then((s) => {
    const a = s.address();
    console.error(`PriceTracker GLP-1 MCP listening on http://${a.address}:${a.port}/mcp`);
  });
}
