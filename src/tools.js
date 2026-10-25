// Tool logic. Pure read-only lookups over PriceTracker GLP-1's open data.
// Every response carries: data_source, last_updated, license, disclosure,
// a not-medical-advice note and links back to pricetrackerglp1.com.

import {
  SITE, URLS, loadPrices, loadFair, loadChanges, loadManufacturerPrices, loadMonthlyReports, loadMonthlyReport,
  classify, drugMatcher, providerMatcher, BILLING_ORDER, billingLabel, billingMonths, programUrl, legitUrl,
} from "./data.js";

export const DISCLOSURE =
  "PriceTracker GLP-1 earns an affiliate commission from some programs it lists. A commission never changes a price, a rank or a date; rankings are by verified all-in price only. Full disclosure: " + URLS.disclosure;
export const NOT_ADVICE =
  "Prices only. Not medical advice and no dosing guidance. GLP-1 medications are prescription drugs; talk to a licensed clinician. Prices are advertised cash prices on a dated read, not quotes, invoices or insurance prices, and are not medically reviewed.";
export const LICENSE = "CC BY 4.0. Attribution: \"PriceTracker GLP-1, pricetrackerglp1.com\" with a link.";
export const COMPOUNDED_NOTE =
  "Compounded semaglutide and tirzepatide are lawful but NOT FDA-approved. See " + `${SITE}/meds/compounded-semaglutide` + " and " + `${SITE}/meds/compounded-tirzepatide`;

export function envelope({ data, sources, lastUpdated, links = {}, notes = [] }) {
  return {
    ...data,
    notes,
    links: { site: SITE, methodology: URLS.methodology, open_data: URLS.data, ...links },
    data_source: { publisher: "PriceTracker GLP-1 (pricetrackerglp1.com)", urls: [...new Set(sources)] },
    last_updated: lastUpdated,
    license: LICENSE,
    affiliate_disclosure: DISCLOSURE,
    not_medical_advice: NOT_ADVICE,
  };
}

function shapeOffer(r) {
  const c = classify(r.medication);
  return {
    program: r.program,
    program_slug: r.program_slug,
    medication: r.medication,
    molecule: c.molecule,
    product_type: c.product_type,
    product_label: c.label,
    form: r.form,
    dose: r.dose || null,
    billing: billingLabel(r.billing),
    advertised_usd: r.advertised_usd,
    membership_fee_usd: r.membership_fee_usd === "" ? null : r.membership_fee_usd,
    all_in_monthly_usd: r.all_in_usd,
    paid_up_front_usd: r.billing === "monthly" ? null : Math.round(r.all_in_usd * billingMonths(r.billing) * 100) / 100,
    checked: r.checked,
    seller_source_url: r.source_url,
    pricetracker_page: programUrl(r.program_slug),
    seller_check_page: legitUrl(r.program_slug),
  };
}

const byPrice = (a, b) =>
  a.all_in_usd - b.all_in_usd
  || (BILLING_ORDER[a.billing] ?? 9) - (BILLING_ORDER[b.billing] ?? 9)
  || a.program.localeCompare(b.program);

function filterRows(rows, { drug, provider, form, billing, no_membership }) {
  const dm = drugMatcher(drug);
  const pm = providerMatcher(provider);
  return rows.filter((r) => {
    const c = classify(r.medication);
    if (!dm(c, r.medication)) return false;
    if (!pm(r)) return false;
    if (form && form !== "any" && r.form !== form) return false;
    if (billing === "month_to_month" && r.billing !== "monthly") return false;
    if (no_membership && Number(r.membership_fee_usd || 0) > 0) return false;
    return true;
  });
}

const anyCompounded = (offers) => offers.some((o) => o.product_type === "compounded" || o.product_type === "unbranded");

/* 1. price lookup by drug and provider */
export async function searchPrices(args = {}) {
  const d = await loadPrices();
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 200);
  const matched = filterRows(d.rows, args).sort(byPrice);
  const offers = matched.slice(0, limit).map(shapeOffer);
  const notes = [];
  if (matched.length === 0) {
    notes.push(`No offers matched. Try list_programs for program names, or drug one of: semaglutide, tirzepatide, wegovy, ozempic, zepbound, mounjaro, foundayo, compounded semaglutide, compounded tirzepatide.`);
  }
  if (anyCompounded(offers)) notes.push(COMPOUNDED_NOTE);
  return envelope({
    data: {
      query: { drug: args.drug ?? null, provider: args.provider ?? null, form: args.form ?? "any", billing: args.billing ?? "any", no_membership: !!args.no_membership },
      total_matches: matched.length,
      returned: offers.length,
      offers,
    },
    sources: [URLS.prices],
    lastUpdated: d.as_of,
    notes,
    links: { board: SITE, ...(args.provider && offers[0] ? { program: offers[0].pricetracker_page } : {}) },
  });
}

/* 2. cheapest-first list: one row per program, its cheapest matching offer */
const CHEAPEST_PAGES = {
  semaglutide: "/cheapest/semaglutide", tirzepatide: "/cheapest/tirzepatide", zepbound: "/cheapest/zepbound",
  wegovy: "/cheapest/wegovy",
};
export async function listCheapest(args = {}) {
  const d = await loadPrices();
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const matched = filterRows(d.rows, args).sort(byPrice);
  const seen = new Set();
  const perProgram = [];
  for (const r of matched) {
    if (seen.has(r.program_slug)) continue;
    seen.add(r.program_slug);
    perProgram.push(r);
  }
  const ranked = perProgram.slice(0, limit).map((r, i) => ({ rank: i + 1, ...shapeOffer(r) }));
  const notes = [
    "Ranked by verified all-in monthly price (membership fees included); ties go to the shorter commitment, then the name. No program can pay for placement.",
    "A price on a 3, 6 or 12-month plan is usually billed up front: see paid_up_front_usd.",
  ];
  if (anyCompounded(ranked)) notes.push(COMPOUNDED_NOTE);
  const key = String(args.drug || "").toLowerCase();
  const page = args.no_membership ? "/cheapest/no-membership"
    : args.form === "oral" && key.includes("semaglutide") ? "/cheapest/oral-semaglutide"
    : CHEAPEST_PAGES[key] || "/cheapest/glp-1";
  return envelope({
    data: {
      query: { drug: args.drug ?? "any", form: args.form ?? "any", billing: args.billing ?? "any", no_membership: !!args.no_membership },
      programs_matching: perProgram.length,
      programs_tracked: d.programs_tracked,
      ranking: ranked,
    },
    sources: [URLS.prices],
    lastUpdated: d.as_of,
    notes,
    links: { cheapest_page: SITE + page, board: SITE },
  });
}

/* 3. price history: observed price changes (+ current price) */
export async function getPriceHistory(args = {}) {
  const [d, ch] = await Promise.all([loadPrices(), loadChanges()]);
  const pm = providerMatcher(args.provider);
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const changes = ch.rows
    .filter((r) => pm(r))
    .filter((r) => args.include_new_plan_terms !== false || r.counted_as_price_change)
    .sort((a, b) => b.read.localeCompare(a.read))
    .slice(0, limit)
    .map((r) => ({
      read: r.read,
      previous_read: r.previous_read,
      program: r.program,
      program_slug: r.program_slug,
      from_usd: r.from_usd,
      to_usd: r.to_usd,
      change_usd: Math.round((r.to_usd - r.from_usd) * 100) / 100,
      kind: r.kind,
      counted_as_price_change: r.counted_as_price_change,
      note: r.note || null,
      seller_source_url: r.source_url || null,
      pricetracker_page: programUrl(r.program_slug),
    }));
  let current = null;
  if (args.provider) {
    const rows = d.rows.filter((r) => pm(r)).sort(byPrice);
    if (rows.length) {
      current = {
        program: rows[0].program,
        cheapest_now: shapeOffer(rows[0]),
        offers_tracked_now: rows.length,
      };
    }
  }
  const notes = [
    `Observed price history starts ${ch.observations_began}. ${ch.definition}`,
    "Programs whose price has not changed since tracking began have no change rows; their current price is still dated.",
  ];
  if (args.provider && !current && changes.length === 0) notes.push("No program matched. Use list_programs for names.");
  return envelope({
    data: {
      query: { provider: args.provider ?? null },
      observations_began: ch.observations_began,
      current,
      changes,
    },
    sources: [URLS.changes, URLS.prices],
    lastUpdated: d.as_of,
    notes,
    links: {
      price_changes: URLS.changesPage,
      changes_rss: `${SITE}/changes/feed.xml`,
      ...(current ? { program: programUrl(current.cheapest_now.program_slug) } : {}),
    },
  });
}

/* 4. manufacturer cash (self-pay) prices */
export async function getManufacturerPrices(args = {}) {
  const [m, d] = await Promise.all([loadManufacturerPrices(), loadPrices()]);
  const want = args.drug ? String(args.drug).toLowerCase() : null;
  const drugs = want && want !== "all"
    ? m.drugs.filter((x) => x.drug.toLowerCase() === want
      || (want === "semaglutide" && /wegovy|ozempic/i.test(x.drug))
      || (want === "tirzepatide" && /zepbound/i.test(x.drug))
      || (want === "orforglipron" && /foundayo/i.test(x.drug)))
    : m.drugs;
  const reads = drugs.map((x) => x.read_date).filter(Boolean).sort();
  const notes = [
    "Published manufacturer self-pay (cash) prices, not negotiated or insurance prices. Dose labels identify which published price applies; they are not dosing guidance.",
    ...m.notes,
  ];
  if (want && drugs.length === 0) notes.push("No manufacturer cash price on file for that drug. Available: " + m.drugs.map((x) => x.drug).join(", ") + ".");
  return envelope({
    data: { query: { drug: args.drug ?? "all" }, manufacturer_cash_prices: drugs },
    sources: [URLS.llmsFull],
    lastUpdated: reads.at(-1) || d.as_of,
    notes,
    links: { savings_cards: URLS.savings, what_every_glp1_costs: `${SITE}/cost/glp-1` },
  });
}

/* 5. GLP-1 Price Index: live figure + fair cash price + monthly reports */
export async function getPriceIndex(args = {}) {
  const [d, fair] = await Promise.all([loadPrices(), loadFair()]);
  let reports;
  if (args.month) {
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw new Error("month must be YYYY-MM");
    const r = await loadMonthlyReport(args.month);
    reports = r ? [r] : [];
  } else {
    reports = await loadMonthlyReports(d.observations_began);
  }
  const notes = [d.definition, fair.definition];
  if (args.month && reports.length === 0) notes.push(`No monthly report is published for ${args.month}. Monthly reports are frozen at publication; the live index below is current.`);
  return envelope({
    data: {
      live_index: {
        as_of: d.as_of,
        index_usd: d.index_usd,
        low_usd: d.low_usd,
        high_usd: d.high_usd,
        programs_tracked: d.programs_tracked,
        programs_quoting: d.programs_quoting,
        by_molecule: d.by_molecule,
        observations_began: d.observations_began,
      },
      fair_cash_price: {
        month: fair.month,
        method_version: fair.method_version,
        minimum_programs: fair.minimum_programs,
        rows: fair.rows.map((r) => ({ ...r, product_type: r.brand ? "brand" : "compounded" })),
        page: fair.page,
      },
      monthly_reports: reports,
    },
    sources: [URLS.prices, URLS.fair, ...reports.map((r) => r.url)],
    lastUpdated: d.as_of,
    notes,
    links: { price_index: URLS.index, fair_price: `${URLS.index}#fair-price`, cite: `${SITE}/press` },
  });
}

/* 6. discovery: every program tracked */
export async function listPrograms() {
  const d = await loadPrices();
  const map = new Map();
  for (const r of [...d.rows].sort(byPrice)) {
    if (!map.has(r.program_slug)) {
      map.set(r.program_slug, {
        program: r.program, program_slug: r.program_slug, cheapest_all_in_usd: r.all_in_usd,
        cheapest_billing: billingLabel(r.billing), checked: r.checked, offers: 0,
        pricetracker_page: programUrl(r.program_slug), seller_check_page: legitUrl(r.program_slug),
      });
    }
    map.get(r.program_slug).offers++;
  }
  return envelope({
    data: { programs_tracked: d.programs_tracked, programs: [...map.values()] },
    sources: [URLS.prices],
    lastUpdated: d.as_of,
    links: { programs: `${SITE}/programs` },
  });
}
