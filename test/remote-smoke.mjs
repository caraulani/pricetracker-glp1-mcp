// Smoke test a deployed endpoint (e.g. a Vercel preview or production):
//   MCP_URL=https://<preview>.vercel.app/api/mcp node test/remote-smoke.mjs
// Lists the tools and calls each one once. Exits 1 on any failure.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL || process.argv[2];
if (!url) { console.error("Set MCP_URL or pass the endpoint URL"); process.exit(2); }
const headers = {};
if (process.env.VERCEL_BYPASS) headers["x-vercel-protection-bypass"] = process.env.VERCEL_BYPASS;
const client = new Client({ name: "ptg-remote-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
const calls = {
  search_glp1_prices: { drug: "semaglutide" },
  list_cheapest_glp1_programs: {},
  get_glp1_price_history: {},
  get_manufacturer_cash_prices: {},
  get_glp1_price_index: {},
  list_glp1_programs: {},
};
let fail = 0;
const { tools } = await client.listTools();
console.log(`tools/list: ${tools.length} tools`);
for (const [name, args] of Object.entries(calls)) {
  try {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content?.[0]?.text);
    const o = JSON.parse(r.content[0].text);
    if (!o.last_updated || !o.data_source) throw new Error("missing envelope");
    console.log(`ok   ${name} (last_updated ${o.last_updated})`);
  } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
}
await client.close();
process.exit(fail ? 1 : 0);
