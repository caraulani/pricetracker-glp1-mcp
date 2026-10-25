// PROPOSED file for the pricetrackerglp1 site repo: src/app/api/mcp/route.ts
// NOT applied anywhere. See PUBLISH-PLAN.md, step 3.
//
// Option 1 (shown): depend on the published npm package and reuse its
// web-standard handler. It reads the site's own public /data JSON over HTTP
// (cached 15 min in memory), so it needs no DB access and cannot write.
//
//   npm i pricetracker-glp1-mcp @modelcontextprotocol/sdk zod
//
// Option 2: copy src/ from this package into src/lib/mcp/ and point
// PTG_BASE_URL at the deployment, or swap data.js loaders for direct imports
// of getPriceIndex()/datasetRows() to skip the self-fetch.
import { handleMcpRequest } from "pricetracker-glp1-mcp/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = (req: Request) => handleMcpRequest(req);
export const POST = (req: Request) => handleMcpRequest(req);
export const OPTIONS = (req: Request) => handleMcpRequest(req);
export const DELETE = (req: Request) => handleMcpRequest(req);
