import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handler, readJson, ApiError } from "@/lib/http";

export const runtime = "nodejs";

/** POST /api/feedback/hide?key=READ_KEY { id, hidden } -> take a message off the public wall, or put it back. */
const INBOX = (process.env.INBOX_URL ?? "").replace(/\/$/, "");
const READ = process.env.INBOX_READ_KEY ?? "";
const body = z.object({ id: z.string().uuid(), hidden: z.boolean() });

export const POST = handler("feedback-hide", async (req: NextRequest) => {
  if (!INBOX || !READ) throw new ApiError(503, "messages are not open right now");
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key || key !== READ) throw new ApiError(401, "wrong key");
  const b = await readJson(req, body);
  const r = await fetch(`${INBOX}/hide`, { method: "POST", headers: { "content-type": "application/json", "x-inbox-key": READ }, body: JSON.stringify(b), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new ApiError(502, "could not update the message");
  return NextResponse.json({ ok: true });
}, 60);
