import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/rpc -> a read-only window onto the chain for the pages.
 *
 * A wallet made at sign-in has no window.ethereum to read through, and some networks
 * cannot reach the public RPC from the browser at all. The pages wait for receipts and
 * read balances here instead, same origin, no key involved. Only read methods are let
 * through: nothing that signs, sends or costs the RPC a log scan.
 */
const ALLOWED = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getTransactionReceipt", "eth_getTransactionByHash",
  "eth_call", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_gasPrice", "eth_estimateGas",
]);
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export const POST = handler("rpc", async (req) => {
  let body: unknown;
  try { body = await req.json(); } catch { throw new ApiError(400, "request body must be valid JSON"); }
  const calls: Call[] = Array.isArray(body) ? body : [body as Call];
  if (calls.length === 0 || calls.length > 10) throw new ApiError(400, "between 1 and 10 calls per request");
  for (const c of calls) {
    if (!c || typeof c.method !== "string" || !ALLOWED.has(c.method)) throw new ApiError(400, `method not allowed: ${String(c?.method)}`);
    if (c.params !== undefined && !Array.isArray(c.params)) throw new ApiError(400, "params must be an array");
  }
  const res = await fetch(RPC_URL, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify(Array.isArray(body) ? calls : calls[0]), signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ApiError(502, "the chain could not be read just now; try again in a moment");
  return NextResponse.json(await res.json(), { headers: { "Cache-Control": "no-store" } });
}, 600);
