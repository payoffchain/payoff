import { NextResponse } from "next/server";
import { handler } from "@/lib/http";

export const runtime = "nodejs";

/**
 * GET /api/logo/NVDA -> a ticker logo, fetched server-side and cached, so the page
 * stays same-origin. A monogram SVG when no source has one.
 */
const SOURCES = (symbol: string) => [
  `https://assets.parqet.com/logos/symbol/${symbol}?format=png&size=64`,
  `https://logo.synthfinance.com/ticker/${symbol}`,
];

const RASTER = new Set(["image/png", "image/jpeg", "image/webp"]);
/** Opened directly, the response is an inert image: no script, no plugins, no sniffing. */
const LOCKED = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "x-content-type-options": "nosniff" };

export const GET = handler("logo", async (req) => {
  const symbol = decodeURIComponent(new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").replace(/\.{2,}/g, ".").slice(0, 12);
  if (!symbol) return new NextResponse(null, { status: 404 });
  for (const url of SOURCES(symbol)) {
    try {
      const res = await fetch(url, { headers: { accept: "image/png,image/jpeg,image/webp" }, signal: AbortSignal.timeout(4000) });
      // Raster only. This response is re-served from our origin, and an SVG from someone
      // else's host is a document that can carry script.
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!res.ok || !RASTER.has(type)) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 200 || buf.byteLength > 512_000) continue;
      return new NextResponse(buf, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=86400, s-maxage=86400", ...LOCKED } });
    } catch { /* next source */ }
  }
  // No source has one: a monogram tile, served as an image so the page never logs a
  // failed request and the slot never flickers between "image" and "text".
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e9edfc"/><text x="32" y="38" text-anchor="middle" font-family="IBM Plex Mono, Consolas, monospace" font-size="${symbol.length > 3 ? 15 : 20}" font-weight="600" fill="#5b78f2">${symbol.slice(0, 4)}</text></svg>`;
  return new NextResponse(svg, { status: 200, headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600, s-maxage=86400", "x-logo": "monogram", ...LOCKED } });
});
