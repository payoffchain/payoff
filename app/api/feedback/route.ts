import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handler, readJson, ApiError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/feedback { name?, contact?, message } -> stored in the private inbox.
 * GET  /api/feedback?key=READ_KEY                -> the messages, newest first (team only).
 * The inbox itself is a Railway service; its keys never reach the browser.
 */
const INBOX = (process.env.INBOX_URL ?? "").replace(/\/$/, "");
const WRITE = process.env.INBOX_WRITE_KEY ?? "";
const READ = process.env.INBOX_READ_KEY ?? "";

const body = z.object({
  name: z.string().max(40).optional(),
  contact: z.string().max(80).optional(),
  message: z.string().min(2, "write a message first").max(1000, "keep it under 1000 characters"),
  website: z.string().max(200).optional(), // honeypot: people never fill it, bots do
});

function ensure() {
  if (!INBOX || !WRITE || !READ) throw new ApiError(503, "messages are not open right now");
}

export const POST = handler("feedback", async (req: NextRequest) => {
  ensure();
  const b = await readJson(req, body);
  if (b.website) return NextResponse.json({ ok: true }); // drop bot posts quietly
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const r = await fetch(`${INBOX}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-inbox-key": WRITE },
    body: JSON.stringify({ name: b.name, contact: b.contact, message: b.message, ip }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new ApiError(502, "your message could not be saved; please try again");
  return NextResponse.json({ ok: true }, { status: 201 });
}, 5);

export const GET = handler("feedback-read", async (req: NextRequest) => {
  ensure();
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key || key !== READ) throw new ApiError(401, "wrong key");
  const r = await fetch(`${INBOX}/messages?limit=1000`, { headers: { "x-inbox-key": READ }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new ApiError(502, "the inbox could not be read");
  return NextResponse.json(await r.json(), { headers: { "Cache-Control": "no-store" } });
}, 30);
