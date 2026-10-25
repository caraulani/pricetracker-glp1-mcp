// Integration tests against the LIVE pricetrackerglp1.com data files.
// Run: npm test   (needs network)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startHttpServer } from "../src/http.js";

let srv, client, base;
const TOOLS = ["search_glp1_prices", "list_cheapest_glp1_programs", "get_glp1_price_history",
  "get_manufacturer_cash_prices", "get_glp1_price_index", "list_glp1_programs"];

before(async () => {
  srv = await startHttpServer({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${srv.address().port}`;
  client = new Client({ name: "ptg-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
});
after(async () => { await client?.close(); srv?.close(); });

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name} returned error: ${r.content?.[0]?.text}`);
  return JSON.parse(r.content[0].text);
};

function assertEnvelope(o) {
  assert.match(o.data_source.urls[0], /^https:\/\/pricetrackerglp1\.com\//);
  assert.match(o.last_updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(o.affiliate_disclosure, /affiliate commission/);
  assert.match(o.not_medical_advice, /Not medical advice/);
  assert.match(o.license, /CC BY 4\.0/);
  assert.equal(o.links.site, "https://pricetrackerglp1.com");
  // no dosing advice language in any response
  assert.doesNotMatch(JSON.stringify(o), /you should take|recommended dose|titrate to|inject \d/i);
}

test("server info + tools are listed, all read-only", async () => {
  assert.equal(client.getServerVersion().name, "pricetracker-glp1");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name);
    assert.equal(t.annotations?.destructiveHint, false, t.name);
    assert.match(t.description, /no medical or dosing advice/);
    assert.match(t.description, /Affiliate disclosure/);
  }
});

test("search_glp1_prices by drug: brand Zepbound only, dated, linked", async () => {
  const o = await call("search_glp1_prices", { drug: "zepbound" });
  assertEnvelope(o);
  assert.ok(o.offers.length > 0);
  for (const x of o.offers) {
    assert.equal(x.product_type, "brand");
    assert.match(x.medication, /zepbound/i);
    assert.match(x.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(x.pricetracker_page, /^https:\/\/pricetrackerglp1\.com\/p\//);
  }
});

test("search_glp1_prices by provider: partial name works, compounded labelled", async () => {
  const o = await call("search_glp1_prices", { provider: "snag" });
  assertEnvelope(o);
  assert.ok(o.offers.length > 0);
  assert.ok(o.offers.every((x) => x.program_slug === "snagrx"));
  const comp = o.offers.filter((x) => x.product_type === "compounded");
  assert.ok(comp.length > 0);
  for (const x of comp) assert.match(x.product_label, /NOT FDA-approved/);
  assert.ok(o.notes.some((n) => /NOT FDA-approved/.test(n)));
});

test("list_cheapest_glp1_programs: one row per program, sorted ascending", async () => {
  const o = await call("list_cheapest_glp1_programs", { limit: 50 });
  assertEnvelope(o);
  const r = o.ranking;
  assert.ok(r.length >= 5);
  assert.equal(new Set(r.map((x) => x.program_slug)).size, r.length);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].all_in_monthly_usd >= r[i - 1].all_in_monthly_usd);
  assert.equal(r[0].rank, 1);
  assert.match(o.links.cheapest_page, /\/cheapest\//);
});

test("list_cheapest: filters (tirzepatide, month to month, oral)", async () => {
  const a = await call("list_cheapest_glp1_programs", { drug: "tirzepatide", billing: "month_to_month" });
  assert.ok(a.ranking.every((x) => x.molecule === "tirzepatide" && x.billing === "month to month"));
  const b = await call("list_cheapest_glp1_programs", { form: "oral" });
  assert.ok(b.ranking.every((x) => x.form === "oral"));
});

test("get_glp1_price_history: market changes and per-provider", async () => {
  const all = await call("get_glp1_price_history", {});
  assertEnvelope(all);
  assert.match(all.observations_began, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(all.changes));
  for (let i = 1; i < all.changes.length; i++) assert.ok(all.changes[i].read <= all.changes[i - 1].read);
  if (all.changes.length) {
    const slug = all.changes[0].program_slug;
    const one = await call("get_glp1_price_history", { provider: slug });
    assert.ok(one.changes.every((c) => c.program_slug === slug));
    assert.ok(one.current && one.current.cheapest_now.program_slug === slug);
  }
});

test("get_manufacturer_cash_prices: four brands with ladders and read dates", async () => {
  const o = await call("get_manufacturer_cash_prices", {});
  assertEnvelope(o);
  const names = o.manufacturer_cash_prices.map((d) => d.drug);
  for (const n of ["Ozempic", "Wegovy", "Zepbound", "Foundayo"]) assert.ok(names.includes(n), `missing ${n}`);
  for (const d of o.manufacturer_cash_prices) {
    assert.ok(d.ladder.length > 0);
    assert.ok(d.ladder.every((s) => typeof s.monthly_cash_price_usd === "number" && s.monthly_cash_price_usd > 0));
    assert.match(d.read_date, /^\d{4}-\d{2}-\d{2}$/);
  }
  const t = await call("get_manufacturer_cash_prices", { drug: "tirzepatide" });
  assert.deepEqual(t.manufacturer_cash_prices.map((d) => d.drug), ["Zepbound"]);
});

test("get_glp1_price_index: live index + fair price + monthly reports", async () => {
  const o = await call("get_glp1_price_index", {});
  assertEnvelope(o);
  assert.ok(o.live_index.index_usd > 0);
  assert.ok(o.live_index.low_usd <= o.live_index.index_usd && o.live_index.index_usd <= o.live_index.high_usd);
  assert.ok(o.fair_cash_price.rows.length > 0);
  assert.ok(o.monthly_reports.length >= 1);
  for (const r of o.monthly_reports) {
    assert.ok(r.index_usd > 0, `report ${r.month} has no index`);
    assert.match(r.url, /\/price-index\/\d{4}-\d{2}$/);
  }
  const one = await call("get_glp1_price_index", { month: o.monthly_reports[0].month });
  assert.equal(one.monthly_reports.length, 1);
  const bad = await client.callTool({ name: "get_glp1_price_index", arguments: { month: "nope" } });
  assert.equal(bad.isError, true);
});

test("list_glp1_programs matches programs_tracked", async () => {
  const o = await call("list_glp1_programs");
  assertEnvelope(o);
  assert.equal(o.programs.length, o.programs_tracked);
});

test("HTTP surface: GET info, 404, health, CORS preflight", async () => {
  const info = await (await fetch(`${base}/mcp`)).json();
  assert.equal(info.read_only, true);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const pre = await fetch(`${base}/api/mcp`, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
});

test("stdio transport (npx entry) lists the same tools", async () => {
  const c = new Client({ name: "ptg-stdio-test", version: "1.0.0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../bin/pricetracker-glp1-mcp.js", import.meta.url).pathname] }));
  const { tools } = await c.listTools();
  assert.equal(tools.length, TOOLS.length);
  const r = await c.callTool({ name: "list_cheapest_glp1_programs", arguments: { limit: 1 } });
  assert.equal(JSON.parse(r.content[0].text).ranking.length, 1);
  await c.close();
});
