// Web-standard (Request -> Response) handler. Works in a Next.js App Router
// route (app/api/mcp/route.ts), Vercel Functions, Cloudflare Workers, Bun, Deno.
// Stateless streamable HTTP: a fresh server per request, no sessions, no auth.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, NAME, VERSION } from "./server.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export async function handleMcpRequest(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET" && !(req.headers.get("accept") || "").includes("text/event-stream")) {
    // friendly description for humans and directory crawlers
    return withCors(Response.json({
      name: NAME, version: VERSION, transport: "streamable-http", auth: "none", read_only: true,
      docs: "https://pricetrackerglp1.com/data",
      tools: ["search_glp1_prices", "list_cheapest_glp1_programs", "get_glp1_price_history", "get_manufacturer_cash_prices", "get_glp1_price_index", "list_glp1_programs"],
    }));
  }
  if (req.method !== "POST") {
    // stateless server: no standalone SSE stream, no session deletion
    return withCors(new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to this endpoint." }, id: null }), {
      status: 405, headers: { "content-type": "application/json", allow: "POST, GET, OPTIONS" },
    }));
  }
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    // json response mode: the body is fully built once handleRequest resolves
    queueMicrotask(() => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  }
}
