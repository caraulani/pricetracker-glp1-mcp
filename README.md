# PriceTracker GLP-1 — MCP server

**What GLP-1s really cost, checked every week, inside Claude, ChatGPT, Grok and Cursor.**

A free, read-only [Model Context Protocol](https://modelcontextprotocol.io) server for [PriceTracker GLP-1](https://pricetrackerglp1.com), the independent tracker of US telehealth GLP-1 prices. Your AI gets dated, source-linked prices instead of stale training data. Ask *"What's the cheapest compounded tirzepatide month to month right now?"* or *"What does Zepbound cost self-pay at 5 mg?"*. The answer comes with the date each price was checked and a link to the page it came from.

- 🔌 **Endpoint:** `https://pricetrackerglp1.com/api/mcp` (streamable HTTP)
- 🔓 **No account, no key, no sign-up.** Read-only. Free.
- 📊 **Data:** [pricetrackerglp1.com/data](https://pricetrackerglp1.com/data), CC BY 4.0

> **Prices only.** This server gives no medical or dosing advice. GLP-1 medications are prescription drugs, so talk to a licensed clinician. Compounded semaglutide and tirzepatide are lawful but **not FDA-approved**, and every compounded offer is labelled that way.

## Tools

| Ask your AI… | Tool |
| --- | --- |
| "What does SnagRx charge for semaglutide?" · "Every Zepbound price you track" | `search_glp1_prices` |
| "Cheapest tirzepatide programs, month to month, no membership fee" | `list_cheapest_glp1_programs` |
| "Has CoreAge Rx changed its price?" · "Which GLP-1 prices moved this month?" | `get_glp1_price_history` |
| "What does Wegovy cost self-pay from Novo?" · "Zepbound cash price ladder" | `get_manufacturer_cash_prices` |
| "What's the GLP-1 Price Index this month?" · "Fair cash price for compounded semaglutide" | `get_glp1_price_index` |
| "Which programs do you track?" | `list_glp1_programs` |

Filters: `drug` (semaglutide, tirzepatide, orforglipron, wegovy, ozempic, zepbound, mounjaro, foundayo, compounded semaglutide, compounded tirzepatide, compounded, brand), `provider` (name or slug; partial names work), `form` (injection / oral), `billing` (`month_to_month` leaves out prepaid plans), `no_membership`.

**Every response includes:**
- `last_updated` plus a `checked` date on each price;
- `data_source` URLs;
- the CC BY 4.0 `license`;
- `affiliate_disclosure` and `not_medical_advice`;
- `links` back to the matching pricetrackerglp1.com page: the program page, the seller check, cheapest-by-drug, the index and the changes feed.

Prices are **all-in**, meaning the advertised price plus any verified membership fee. For prepaid 3, 6 and 12-month plans, the amount billed up front is shown too.

## Setup

**Claude (web and desktop):** Settings → Connectors → *Add custom connector*. Use the name `PriceTracker GLP-1` and the URL `https://pricetrackerglp1.com/api/mcp`.

**Claude Code**
```bash
claude mcp add --transport http pricetracker-glp1 https://pricetrackerglp1.com/api/mcp
```

**ChatGPT (developer mode) / Grok:** add a custom MCP connector with the same URL. No auth is needed.

**Cursor, Windsurf and other config-file clients**
```json
{ "mcpServers": { "pricetracker-glp1": { "url": "https://pricetrackerglp1.com/api/mcp" } } }
```

**stdio-only clients (runs locally and reads the same public data)**
```json
{ "mcpServers": { "pricetracker-glp1": { "command": "npx", "args": ["-y", "pricetracker-glp1-mcp"] } } }
```

## Self-host / embed

```bash
npm i pricetracker-glp1-mcp
npx pricetracker-glp1-mcp --http          # streamable HTTP on $PORT (default 3000) at /mcp
```

```ts
// Next.js App Router: app/api/mcp/route.ts
import { handleMcpRequest } from "pricetracker-glp1-mcp/web";
export const POST = handleMcpRequest, GET = handleMcpRequest, OPTIONS = handleMcpRequest;
```

The handler is a stateless web-standard `Request → Response` function, so it runs on Vercel, Cloudflare Workers, Bun and Deno. Data comes from the public JSON files. In-memory caching lasts 15 minutes (`PTG_CACHE_TTL_MS`), and if the source is briefly unavailable the last good copy is served. The standalone server applies a per-IP rate limit (`RATE_LIMIT_PER_MIN`, default 60).

## Data and method

| Source | Refresh | What it contains |
| --- | --- | --- |
| [`/data/glp1-prices.json`](https://pricetrackerglp1.com/data/glp1-prices.json) | hourly recompute; seller pages re-read weekly | every offer, the index, per-molecule stats |
| [`/data/glp1-price-changes.json`](https://pricetrackerglp1.com/data/glp1-price-changes.json) | on each read | genuine price changes since 2026-08-20 |
| [`/data/glp1-fair-cash-price.json`](https://pricetrackerglp1.com/data/glp1-fair-cash-price.json) | monthly method | median month-to-month price per product (3+ programs) |
| [`/llms-full.txt`](https://pricetrackerglp1.com/llms-full.txt) | on publish | manufacturer self-pay ladders |
| [`/price-index/YYYY-MM`](https://pricetrackerglp1.com/price-index) | monthly | index reports, frozen at publication |

Ranking is by verified all-in price. Ties go to the shorter commitment and then to the name. No program can pay for placement. See the [methodology](https://pricetrackerglp1.com/methodology), [sources](https://pricetrackerglp1.com/sources) and [corrections](https://pricetrackerglp1.com/corrections).

**Affiliate disclosure:** PriceTracker GLP-1 earns a commission from some programs it lists. A commission never changes a price, a rank or a date ([details](https://pricetrackerglp1.com/affiliate-disclosure)).

**Cite:** PriceTracker GLP-1, pricetrackerglp1.com (CC BY 4.0).

## Develop

```bash
npm install
npm test        # 11 integration tests against the live data (HTTP + stdio clients)
npm start       # http://localhost:3000/mcp
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/list
```

## License

The code is MIT. The price data is © PriceTracker GLP-1, published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
