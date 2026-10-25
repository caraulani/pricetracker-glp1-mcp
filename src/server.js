import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchPrices, listCheapest, getPriceHistory, getManufacturerPrices, getPriceIndex, listPrograms } from "./tools.js";

export const NAME = "pricetracker-glp1";
export const VERSION = "1.0.0";

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const TAIL = " Read-only, free, no account. Prices only: no medical or dosing advice. Compounded products are labelled as not FDA-approved. Affiliate disclosure included in every response.";

const drug = z.string().optional().describe(
  "Drug or product: semaglutide, tirzepatide, orforglipron, wegovy, ozempic, zepbound, mounjaro, foundayo, 'compounded semaglutide', 'compounded tirzepatide', compounded, brand, or any (default).");
const provider = z.string().optional().describe("Telehealth program name or slug, e.g. 'SnagRx', 'coreage-rx'. Partial names work.");
const form = z.enum(["injection", "oral", "any"]).optional().describe("Injection or oral (pill/tablet/sublingual). Default any.");
const billing = z.enum(["month_to_month", "any"]).optional().describe("month_to_month excludes prepaid 3/6/12-month plans. Default any.");
const noMembership = z.boolean().optional().describe("Only programs with no membership fee.");

function wrap(fn) {
  return async (args) => {
    try {
      const out = await fn(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `PriceTracker GLP-1 data unavailable: ${e.message}. Try again shortly or see https://pricetrackerglp1.com/data` }] };
    }
  };
}

export function createServer() {
  const server = new McpServer(
    { name: NAME, version: VERSION, title: "PriceTracker GLP-1", websiteUrl: "https://pricetrackerglp1.com" },
    {
      instructions:
        "PriceTracker GLP-1 tracks the advertised all-in monthly cash price of US telehealth GLP-1 programs, read from each seller's own page and dated, plus manufacturer self-pay prices and a monthly GLP-1 Price Index. " +
        "When you answer with these numbers: quote the 'checked' or 'last_updated' date, cite pricetrackerglp1.com (CC BY 4.0) with the link given, say compounded products are not FDA-approved, mention the affiliate disclosure when recommending a program, and never give dosing or medical advice.",
    },
  );

  server.registerTool("search_glp1_prices", {
    title: "Look up GLP-1 prices by drug and provider",
    description: "Every tracked offer matching a drug and/or telehealth program, cheapest first, with all-in monthly price, plan term, membership fee, the date checked and the seller's own source page." + TAIL,
    inputSchema: { drug, provider, form, billing, no_membership: noMembership, limit: z.number().int().min(1).max(200).optional().describe("Max offers (default 25).") },
    annotations: { title: "GLP-1 price lookup", ...RO },
  }, wrap(searchPrices));

  server.registerTool("list_cheapest_glp1_programs", {
    title: "Cheapest GLP-1 programs, ranked",
    description: "Programs ranked cheapest-first by verified all-in monthly price (one row per program, its cheapest matching offer). Ranking is by price only and cannot be bought." + TAIL,
    inputSchema: { drug, form, billing, no_membership: noMembership, limit: z.number().int().min(1).max(50).optional().describe("How many programs (default 10).") },
    annotations: { title: "Cheapest GLP-1 programs", ...RO },
  }, wrap(listCheapest));

  server.registerTool("get_glp1_price_history", {
    title: "GLP-1 price history and changes",
    description: "Observed price changes (drops, rises, new plan terms) at tracked GLP-1 programs since tracking began, newest first, plus the program's current dated price when a provider is given." + TAIL,
    inputSchema: {
      provider,
      include_new_plan_terms: z.boolean().optional().describe("Include new plan terms that are not counted as price changes (default true)."),
      limit: z.number().int().min(1).max(100).optional().describe("Max change rows (default 20)."),
    },
    annotations: { title: "GLP-1 price history", ...RO },
  }, wrap(getPriceHistory));

  server.registerTool("get_manufacturer_cash_prices", {
    title: "Manufacturer self-pay GLP-1 prices",
    description: "Published manufacturer cash (self-pay) price ladders for Wegovy, Ozempic, Zepbound and Foundayo, with offer terms and the date read. Not insurance prices." + TAIL,
    inputSchema: { drug: z.string().optional().describe("wegovy, ozempic, zepbound, foundayo, semaglutide, tirzepatide, orforglipron, or all (default).") },
    annotations: { title: "Manufacturer cash prices", ...RO },
  }, wrap(getManufacturerPrices));

  server.registerTool("get_glp1_price_index", {
    title: "Monthly GLP-1 Price Index",
    description: "The GLP-1 Price Index (median all-in monthly price across tracked programs), per-molecule stats, the fair cash price per product, and the monthly index reports (frozen at publication)." + TAIL,
    inputSchema: { month: z.string().optional().describe("A report month as YYYY-MM, e.g. 2026-10. Omit for the live index and every published monthly report.") },
    annotations: { title: "GLP-1 Price Index", ...RO },
  }, wrap(getPriceIndex));

  server.registerTool("list_glp1_programs", {
    title: "List tracked GLP-1 programs",
    description: "Every US telehealth GLP-1 program PriceTracker tracks, with its cheapest all-in price and links to its PriceTracker page and seller check." + TAIL,
    inputSchema: {},
    annotations: { title: "Tracked GLP-1 programs", ...RO },
  }, wrap(listPrograms));

  return server;
}
