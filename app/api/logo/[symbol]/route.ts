import { NextResponse } from "next/server";
import { handler } from "@/lib/http";

export const runtime = "nodejs";

/**
 * GET /api/logo/NVDA -> a ticker logo, fetched server-side and cached, so the page
 * stays same-origin. 404 (no body) when no source has one; the UI shows a monogram.
 */
const SOURCES = (symbol: string) => [
  `https://assets.parqet.com/logos/symbol/${symbol}?format=png&size=64`,
  `https://logo.synthfinance.com/ticker/${symbol}`,
];

export const GET = handler("logo", async (req) => {
  const symbol = decodeURIComponent(new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "").toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!symbol) return new NextResponse(null, { status: 404 });
  for (const url of SOURCES(symbol)) {
    try {
      const res = await fetch(url, { headers: { accept: "image/*" }, signal: AbortSignal.timeout(4000) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 200) continue;
      return new NextResponse(buf, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=86400, s-maxage=86400" } });
    } catch { /* next source */ }
  }
  return new NextResponse(null, { status: 404, headers: { "cache-control": "public, max-age=3600" } });
});
