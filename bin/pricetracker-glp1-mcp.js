#!/usr/bin/env node
// stdio entry for local MCP clients (npx pricetracker-glp1-mcp).
// Pass --http to run the streamable HTTP server instead (PORT env, default 3000).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../src/server.js";
import { startHttpServer } from "../src/http.js";

if (process.argv.includes("--http")) {
  const s = await startHttpServer();
  const a = s.address();
  console.error(`PriceTracker GLP-1 MCP listening on http://${a.address}:${a.port}/mcp`);
} else {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
