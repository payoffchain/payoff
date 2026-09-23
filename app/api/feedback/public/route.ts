import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/http";

export const runtime = "nodejs";

/** GET /api/feedback/public -> the message wall: names and messages, links and addresses masked. */
const INBOX = (process.env.INBOX_URL ?? "").replace(/\/$/, "");

export const GET = handler("feedback-public", async () => {
  if (!INBOX) throw new ApiError(503, "messages are not open right now");
  const r = await fetch(`${INBOX}/public`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new ApiError(502, "messages could not be loaded");
  return NextResponse.json(await r.json(), { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60" } });
});
