// Data layer: reads PriceTracker GLP-1's public, CC BY 4.0 data files.
// Read-only. No keys, no PII, no writes. Everything is cached in memory.

export const SITE = process.env.PTG_BASE_URL?.replace(/\/$/, "") || "https://pricetrackerglp1.com";
const UA = "pricetracker-glp1-mcp/1.0 (+https://pricetrackerglp1.com/data)";
const TTL_MS = Number(process.env.PTG_CACHE_TTL_MS || 15 * 60 * 1000);

export const URLS = {
  prices: `${SITE}/data/glp1-prices.json`,
  fair: `${SITE}/data/glp1-fair-cash-price.json`,
  changes: `${SITE}/data/glp1-price-changes.json`,
  llmsFull: `${SITE}/llms-full.txt`,
  index: `${SITE}/price-index`,
  changesPage: `${SITE}/changes`,
  data: `${SITE}/data`,
  methodology: `${SITE}/methodology`,
  disclosure: `${SITE}/affiliate-disclosure`,
  savings: `${SITE}/savings`,
};

const cache = new Map();

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = loader()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      // serve stale data rather than fail, if we have it
      if (hit?.value !== undefined) return hit.value;
      cache.delete(key);
      throw err;
    });
  cache.set(key, { ...(hit || {}), pending });
  return pending;
}

async function get(url, kind = "json") {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: kind === "json" ? "application/json" : "text/plain,text/html" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const e = new Error(`GET ${url} -> HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return kind === "json" ? res.json() : res.text();
}

export const loadPrices = () => cached("prices", () => get(URLS.prices));
export const loadFair = () => cached("fair", () => get(URLS.fair));
export const loadChanges = () => cached("changes", () => get(URLS.changes));
export const loadLlmsFull = () => cached("llmsFull", () => get(URLS.llmsFull, "text"));

/* ---------- product classification (labels only, never advice) ---------- */

const BRANDS = [
  { re: /wegovy/i, brand: "Wegovy", molecule: "semaglutide", maker: "Novo Nordisk" },
  { re: /ozempic/i, brand: "Ozempic", molecule: "semaglutide", maker: "Novo Nordisk" },
  { re: /rybelsus/i, brand: "Rybelsus", molecule: "semaglutide", maker: "Novo Nordisk" },
  { re: /zepbound/i, brand: "Zepbound", molecule: "tirzepatide", maker: "Eli Lilly" },
  { re: /mounjaro/i, brand: "Mounjaro", molecule: "tirzepatide", maker: "Eli Lilly" },
  { re: /foundayo|orforglipron/i, brand: "Foundayo", molecule: "orforglipron", maker: "Eli Lilly" },
];

export function classify(medication = "") {
  const b = BRANDS.find((x) => x.re.test(medication));
  const molecule = b?.molecule
    || (/tirzepatide/i.test(medication) ? "tirzepatide" : /semaglutide/i.test(medication) ? "semaglutide" : null);
  if (b) {
    return { molecule, brand: b.brand, product_type: "brand", label: `Brand ${b.brand} (FDA-approved product, ${b.maker})` };
  }
  if (/compound/i.test(medication)) {
    return { molecule, brand: null, product_type: "compounded", label: "Compounded: lawful but NOT FDA-approved (not reviewed by FDA for safety, effectiveness or quality)" };
  }
  if (!molecule) {
    return { molecule: null, brand: null, product_type: "not_itemized", label: "Medication not itemized on the seller's site" };
  }
  return {
    molecule,
    brand: null,
    product_type: "unbranded",
    label: "Unbranded listing (no brand named by the seller; typically compounded, which is NOT FDA-approved; check the seller page)",
  };
}

/* ---------- drug filter ---------- */

const DRUG_ALIASES = {
  "glp-1": () => true,
  glp1: () => true,
  any: () => true,
  all: () => true,
  semaglutide: (c) => c.molecule === "semaglutide",
  tirzepatide: (c) => c.molecule === "tirzepatide",
  orforglipron: (c) => c.molecule === "orforglipron",
  foundayo: (c) => c.brand === "Foundayo",
  wegovy: (c) => c.brand === "Wegovy",
  ozempic: (c) => c.brand === "Ozempic",
  zepbound: (c) => c.brand === "Zepbound",
  mounjaro: (c) => c.brand === "Mounjaro",
  rybelsus: (c) => c.brand === "Rybelsus",
  "compounded semaglutide": (c) => c.molecule === "semaglutide" && c.product_type !== "brand",
  "compounded tirzepatide": (c) => c.molecule === "tirzepatide" && c.product_type !== "brand",
  compounded: (c) => c.product_type === "compounded" || c.product_type === "unbranded",
  brand: (c) => c.product_type === "brand",
};

export const DRUG_CHOICES = Object.keys(DRUG_ALIASES);

export function drugMatcher(drug) {
  if (!drug) return () => true;
  const key = String(drug).trim().toLowerCase().replace(/\s+/g, " ").replace(/^compounded-/, "compounded ");
  const fn = DRUG_ALIASES[key];
  if (fn) return fn;
  // free text fallback: substring on the medication name
  return (c, med) => med.toLowerCase().includes(key);
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function providerMatcher(provider) {
  if (!provider) return () => true;
  const p = norm(provider);
  return (row) => norm(row.program) === p || norm(row.program_slug) === p
    || norm(row.program).includes(p) || norm(row.program_slug).includes(p);
}

export const BILLING_ORDER = { monthly: 0, "3mo": 1, "6mo": 2, "12mo": 3 };
export const billingLabel = (b) =>
  ({ monthly: "month to month", "3mo": "3-month plan", "6mo": "6-month plan", "12mo": "12-month plan" }[b] || b);
export const billingMonths = (b) => ({ monthly: 1, "3mo": 3, "6mo": 6, "12mo": 12 }[b] || 1);

export const programUrl = (slug) => `${SITE}/p/${slug}`;
export const legitUrl = (slug) => `${SITE}/is-${slug}-legit`;

/* ---------- manufacturer cash prices (parsed from llms-full.txt) ---------- */

const MED_PAGES = { Ozempic: "ozempic", Zepbound: "zepbound", Wegovy: "wegovy", Foundayo: "foundayo" };

export async function loadManufacturerPrices() {
  const text = await loadLlmsFull();
  const start = text.indexOf("## Manufacturer cash prices");
  if (start < 0) throw new Error("Manufacturer cash price section not found in llms-full.txt");
  const rest = text.slice(start);
  const end = rest.indexOf("\n## ", 5);
  const section = end > 0 ? rest.slice(0, end) : rest;
  const drugs = [];
  const notes = [];
  for (const raw of section.split("\n").slice(1)) {
    const line = raw.replace(/^-\s*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Z][A-Za-z]+):\s*(.+?)(?:\s*Read (\d{4}-\d{2}-\d{2})\.)?$/);
    if (!m) { notes.push(line); continue; }
    const [, drug, ladderText, read] = m;
    // split the ladder on "; " at top level (not inside parentheses)
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of ladderText.replace(/\.$/, "")) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === ";" && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    const ladder = parts.map((p) => {
      const pm = p.match(/^(.*?)\s*\$([\d,]+)(?:\s*\((.*)\))?$/);
      return pm
        ? { dose_label: pm[1].trim(), monthly_cash_price_usd: Number(pm[2].replace(/,/g, "")), terms: pm[3] || null }
        : { dose_label: p, monthly_cash_price_usd: null, terms: null };
    });
    drugs.push({
      drug,
      ladder,
      read_date: read || null,
      page: MED_PAGES[drug] ? `${SITE}/meds/${MED_PAGES[drug]}` : `${SITE}/savings`,
    });
  }
  return { drugs, notes };
}

/* ---------- monthly reports (frozen at publication) ---------- */

function monthsSince(start, end) {
  const out = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function stripHtml(html) {
  const main = html.split("<main").slice(1).join("<main") || html;
  return main
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

export async function loadMonthlyReport(month) {
  return cached(`report:${month}`, async () => {
    const url = `${SITE}/price-index/${month}`;
    let html;
    try {
      html = await get(url, "text");
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
      .find((j) => j && j["@type"] === "Report");
    const text = stripHtml(html);
    const idx = text.match(/Index \$([\d,]+)\/mo median all-in price across (?:the )?(\d+) programs/);
    const floor = text.match(/Floor \$([\d,]+)\/mo ([^$]{0,80}?)(?= [A-Z][a-z]+ |$)/);
    return {
      month,
      url,
      headline: ld?.headline ?? null,
      summary: ld?.description ?? null,
      published: ld?.datePublished ?? null,
      index_usd: idx ? Number(idx[1].replace(/,/g, "")) : null,
      programs: idx ? Number(idx[2]) : null,
      floor_usd: floor ? Number(floor[1].replace(/,/g, "")) : null,
      frozen_at_publication: true,
    };
  });
}

export async function loadMonthlyReports(observationsBegan = "2026-08-20") {
  const now = new Date().toISOString().slice(0, 7);
  const months = monthsSince(observationsBegan.slice(0, 7), now);
  const reports = await Promise.all(months.map((m) => loadMonthlyReport(m).catch(() => null)));
  return reports.filter(Boolean);
}
