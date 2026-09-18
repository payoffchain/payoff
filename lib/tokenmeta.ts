import { ethers } from "ethers";
import registry from "./robinhood-registry.json";
import snapshot from "./morpho-markets.json";
import { ADDR, DEFAULTS } from "./chain";

/**
 * Token metadata without an RPC round trip: Robinhood's Stock Token registry (the
 * canonical symbol/address list for tokenized equities) plus whatever the Morpho market
 * snapshot knows about the other collateral (USDe, WETH, syrupUSDG...).
 */

export type TokenMeta = {
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  /** Robinhood Stock Token from the official registry */
  isStock: boolean;
  logo: string | null;
};

type RegistryToken = { symbol: string; address: string; name: string | null; decimals: number; logoUrl?: string | null };

const byAddress = new Map<string, TokenMeta>();

function put(t: TokenMeta) {
  byAddress.set(t.address.toLowerCase(), t);
}

for (const t of (registry as { tokens: RegistryToken[] }).tokens) {
  put({ address: ethers.getAddress(t.address), symbol: t.symbol, name: t.name ?? null, decimals: t.decimals, isStock: true, logo: t.logoUrl ?? null });
}
for (const m of snapshot.markets) {
  for (const side of [
    { addr: m.collateralToken, meta: m.collateral },
    { addr: m.loanToken, meta: m.loan },
  ]) {
    if (!side.addr || byAddress.has(side.addr.toLowerCase())) continue;
    put({ address: ethers.getAddress(side.addr), symbol: side.meta.symbol, name: side.meta.name ?? null, decimals: side.meta.decimals, isStock: false, logo: null });
  }
}
if (!byAddress.has(DEFAULTS.usdg.toLowerCase())) put({ address: DEFAULTS.usdg, symbol: "USDG", name: "Global Dollar", decimals: 6, isStock: false, logo: null });
if (!byAddress.has(DEFAULTS.weth.toLowerCase())) put({ address: DEFAULTS.weth, symbol: "WETH", name: "Wrapped Ether", decimals: 18, isStock: false, logo: null });

export function tokenMeta(address: string): TokenMeta | null {
  return byAddress.get(address.toLowerCase()) ?? null;
}

export function tokenSymbol(address: string): string {
  return tokenMeta(address)?.symbol ?? address.slice(0, 6) + "…" + address.slice(-4);
}

export function tokenDecimals(address: string): number | null {
  return tokenMeta(address)?.decimals ?? null;
}

export function isUsdg(address: string): boolean {
  return address.toLowerCase() === ADDR.usdg().toLowerCase();
}

/** Ticker-keyed logo, served through /api/logo so the page stays same-origin. */
export function logoPath(symbol: string): string {
  return `/api/logo/${encodeURIComponent(symbol.toUpperCase())}`;
}
