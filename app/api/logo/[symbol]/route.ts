import { NextResponse } from "next/server";
import { handler } from "@/lib/http";

export const runtime = "nodejs";

/**
 * GET /api/logo/cirBTC -> a token logo, fetched server-side and cached, so the page
 * stays same-origin. A monogram SVG when no source has one.
 */
/** Crypto collateral on Arc: known logos first, then the ticker services (for any tokenized stock that arrives). */
const KNOWN: Record<string, string> = {
  CIRBTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  WBTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  BTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
  WETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  USDC: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  EURC: "https://assets.coingecko.com/coins/images/26045/small/euro.png",
};
const SOURCES = (symbol: string) => [
  ...(KNOWN[symbol] ? [KNOWN[symbol]] : []),
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
  // No source has one: a monogram tile, served as an image so the page never logs a
  // failed request and the slot never flickers between "image" and "text".
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e9edfc"/><text x="32" y="38" text-anchor="middle" font-family="IBM Plex Mono, Consolas, monospace" font-size="${symbol.length > 3 ? 15 : 20}" font-weight="600" fill="#5b78f2">${symbol.slice(0, 4)}</text></svg>`;
  return new NextResponse(svg, { status: 200, headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600, s-maxage=86400", "x-logo": "monogram" } });
});
