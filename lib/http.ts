import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConfigError } from "./chain";
import { BadInput } from "./tokens";

/**
 * Shared request plumbing for every route.
 *
 * AUDIT FIX (M4): three routes called `await req.json()` with no try/catch, so a body
 * that was not valid JSON produced a 500 with a stack trace instead of a 400.
 *
 * AUDIT FIX (M5): routes returned `err.message` verbatim. ethers errors carry the RPC
 * URL, contract addresses and raw revert data. Errors are now classified: input problems
 * and config problems say what is wrong, everything else becomes a generic message and
 * the detail is logged server-side.
 *
 * AUDIT FIX (M1): a rate limiter, applied per route. It is in-process, so on a
 * serverless platform each instance counts separately and a determined caller can spread
 * load across instances — it stops accidental hammering and casual abuse, not a
 * distributed attacker. For real protection put a gateway limiter in front, or move the
 * counter to Redis/Upstash. It is deliberately not silent about that.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Parse a JSON body against a schema, or throw an ApiError the handler wrapper renders.
 *
 * @dev The generic is `S extends z.ZodTypeAny` rather than `z.ZodType<T>`: the schemas
 *      below transform their input (a query string "25" becomes the number 25), and
 *      `z.ZodType<T>` pins input and output to the same type, so every caller ended up
 *      with the union of both.
 */
export async function readJson<S extends z.ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") ?? "body";
    throw new ApiError(400, `${path}: ${first?.message ?? "invalid"}`);
  }
  return parsed.data;
}

export function readQuery<S extends z.ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") ?? "query";
    throw new ApiError(400, `${path}: ${first?.message ?? "invalid"}`);
  }
  return parsed.data;
}

// --- rate limiting -----------------------------------------------------------

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60);

/**
 * @dev `x-forwarded-for` is only trustworthy behind a proxy that overwrites it (Vercel
 *      does). Self-hosted without such a proxy, a client can spoof the header and get a
 *      fresh bucket per request — set TRUST_PROXY=false there to fall back to a single
 *      shared bucket, which throttles everyone but cannot be dodged.
 */
function clientKey(req: NextRequest, scope: string): string {
  if (process.env.TRUST_PROXY === "false") return `${scope}:shared`;
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

function rateLimit(req: NextRequest, scope: string, limit: number): { ok: boolean; retryAfter: number } {
  if (limit <= 0) return { ok: true, retryAfter: 0 };
  const key = clientKey(req, scope);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > 10_000) pruneBuckets(now); // bound the map on a long-lived instance
    return { ok: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

function pruneBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

// --- handler wrapper ---------------------------------------------------------

type Handler = (req: NextRequest) => Promise<NextResponse>;

/**
 * The MCP endpoint carries every tool an agent uses behind one scope, and an agent
 * loop legitimately issues several calls per decision, so it gets 4x the REST budget.
 */
export const MCP_LIMIT = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? (DEFAULT_LIMIT <= 0 ? 0 : 240));

export function handler(scope: string, fn: Handler, limit = scope === "mcp" ? MCP_LIMIT : DEFAULT_LIMIT): Handler {
  return async (req: NextRequest) => {
    const gate = rateLimit(req, scope, limit);
    if (!gate.ok) {
      const headers = { "Retry-After": String(gate.retryAfter) };
      if (scope === "mcp") {
        // An MCP client parses JSON-RPC, not {error}; give it a body it can read.
        return NextResponse.json(
          { jsonrpc: "2.0", id: null, error: { code: -32000, message: "too many requests", data: { retryAfter: gate.retryAfter } } },
          { status: 429, headers }
        );
      }
      return NextResponse.json({ error: "too many requests" }, { status: 429, headers });
    }
    try {
      const res = await fn(req);
      // Let Vercel's edge cache serve repeat reads. Every GET here recomputes from the RPC
      // (getLogs over days of blocks, multicalls, feed rounds) and costs 1–15 s cold; the
      // data changes by the block but nobody needs it fresher than ~20 s. With
      // stale-while-revalidate the page stays instant while the function refreshes.
      if (req.method === "GET" && res.status === 200 && !res.headers.has("Cache-Control")) {
        const ttl = CACHE_TTL[scope] ?? 20;
        if (ttl > 0) res.headers.set("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 6}`);
      }
      return res;
    } catch (err) {
      return errorResponse(scope, err);
    }
  };
}

/** Edge cache TTL in seconds per route scope; 0 disables. Default 20. */
// The plan is what the runner signs: it must never be served from the edge after the
// state it was built on has changed. Vault detail is what a user watches after signing.
// A pool-volume read is a log scan, the heaviest thing this API asks of the RPC: once per
// ten minutes per region is plenty for a number that is an hourly average anyway.
const CACHE_TTL: Record<string, number> = { pools: 600, leaderboard: 60, health: 10, plan: 0, vault: 5, targets: 10, activity: 10, "vault-tx": 0, create: 0, mcp: 0, execute: 0 };

export function errorResponse(scope: string, err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof BadInput) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof ConfigError) {
    // Safe to surface: it names an env var, not a secret, and it is the single most
    // common deployment failure. /api/health exists to catch these before traffic does.
    return NextResponse.json({ error: `server not configured: ${err.message}` }, { status: 503 });
  }
  const ethersMessage = ethersArgumentError(err);
  if (ethersMessage) {
    return NextResponse.json({ error: ethersMessage }, { status: 400 });
  }
  console.error(`[${scope}]`, err);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

/**
 * ethers raises INVALID_ARGUMENT / NUMERIC_FAULT when a value cannot be ABI-encoded
 * (an address that fails checksum, a number past uint256, a bad bytes length). Those
 * are the caller's fault; `shortMessage` is safe to surface (no RPC URL or revert data).
 */
export function ethersArgumentError(err: unknown): string | null {
  const e = err as { code?: unknown; shortMessage?: unknown } | null;
  if (!e || typeof e !== "object") return null;
  if (e.code !== "INVALID_ARGUMENT" && e.code !== "NUMERIC_FAULT") return null;
  return typeof e.shortMessage === "string" && e.shortMessage ? e.shortMessage : "invalid argument";
}

/**
 * The error a wide getLogs range produces. Providers phrase it differently, so any
 * failure of the range query is reported the same way with the one lever the caller has.
 */
export function blockRangeError(): ApiError {
  return new ApiError(502, "block range too wide for the RPC; reduce ?blocks=");
}

// --- shared validators -------------------------------------------------------

export const addressSchema = z
  .string()
  .refine((v) => /^0x[0-9a-fA-F]{40}$/.test(v), "must be a 0x-prefixed 20-byte address");

export const uintStringSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+$/.test(v), "must be a non-negative whole number");

export const decimalStringSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d+)?$/.test(v), "must be a non-negative decimal number");

export const intSchema = (min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (/^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN))
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, `must be an integer between ${min} and ${max}`);

/** Pagination shared by every list endpoint. */
export const pageSchema = {
  offset: intSchema(0, 1_000_000).optional().default(0),
  limit: intSchema(1, 100).optional().default(25),
};

/**
 * Seconds from now until the returned calldata expires on-chain (A3). Optional; the
 * service applies a 20-minute default. Bounds mirror lib/services/agent.ts.
 */
export const deadlineSecondsSchema = intSchema(30, 24 * 60 * 60).optional();
