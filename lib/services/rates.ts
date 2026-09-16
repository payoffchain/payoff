import { ethers } from "ethers";
import { ADDR } from "../chain";
import { allMarkets, marketStatesCached, marketsForPair, snapshotInfo, type MarketMeta, type MarketState } from "../morpho";
import { tokenMeta } from "../tokenmeta";
import { ApiError } from "../http";

/**
 * The rate board and the "could you borrow cheaper?" maths.
 *
 * On Arc one collateral usually has several Morpho markets against USDC,
 * created at different LLTVs (39/63/77/86%) and often by different curators. Each has its
 * own utilisation, so each has its own borrow rate. A borrower in one can move to another
 * of the same pair — that is the whole refinancing product — as long as the new market has
 * the liquidity to take the debt and an LLTV that keeps the position healthy.
 */

export type RateRow = {
  id: string;
  collateral: { address: string; symbol: string; decimals: number; isStock: boolean; name: string | null };
  loan: { address: string; symbol: string; decimals: number };
  lltv: number;                 // 0.63
  listed: boolean;
  borrowApy: number | null;
  supplyApy: number | null;
  utilization: number;
  liquidityUsd: number;         // loan token available to borrow, as $ (loan = $1)
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  /** collateral price in loan units per whole token, from the market oracle */
  collateralPrice: number | null;
  oracle: string;
  irm: string;
  lastUpdate: number;
  live: boolean;
  /** oracle price far from the other markets of the same collateral: never "best" */
  oracleSuspect?: boolean;
};

export type RateGroup = {
  collateral: RateRow["collateral"];
  /** cheapest market with meaningful liquidity */
  best: RateRow | null;
  rows: RateRow[];
};

const MIN_LIQUIDITY_USD = Number(process.env.MIN_MARKET_LIQUIDITY_USD ?? 100);

function toRow(m: MarketMeta, s: MarketState | undefined): RateRow {
  const collMeta = tokenMeta(m.params.collateralToken);
  const loanDec = m.loan.decimals;
  const collDec = m.collateral.decimals;
  const price = s?.oraclePrice ? Number(ethers.formatUnits(s.oraclePrice, 36 + loanDec - collDec)) : null;
  const liq = s ? Number(ethers.formatUnits(s.liquidity, loanDec)) : m.snapshotState?.liquidityUsd ?? 0;
  return {
    id: m.id,
    collateral: { address: m.params.collateralToken, symbol: m.collateral.symbol, decimals: collDec, isStock: collMeta?.isStock ?? false, name: (collMeta?.name ?? m.collateral.name ?? null)?.replace(/s*[•·].*$/, "") ?? null },
    loan: { address: m.params.loanToken, symbol: m.loan.symbol, decimals: loanDec },
    lltv: Number(m.params.lltv) / 1e18,
    listed: m.listed,
    borrowApy: s ? s.borrowApy : m.snapshotState?.borrowApy ?? null,
    supplyApy: s ? s.supplyApy : m.snapshotState?.supplyApy ?? null,
    utilization: s ? s.utilization : m.snapshotState?.utilization ?? 0,
    liquidityUsd: liq,
    totalSupplyUsd: s ? Number(ethers.formatUnits(s.totalSupplyAssets, loanDec)) : m.snapshotState?.supplyUsd ?? 0,
    totalBorrowUsd: s ? Number(ethers.formatUnits(s.totalBorrowAssets, loanDec)) : m.snapshotState?.borrowUsd ?? 0,
    collateralPrice: price,
    oracle: m.params.oracle,
    irm: m.params.irm,
    lastUpdate: s?.lastUpdate ?? 0,
    live: !!s,
  };
}

/** Rows for every USDC market, grouped by collateral, cheapest first inside a group. */
export async function rateBoard(opts: { live?: boolean; minLiquidityUsd?: number } = {}) {
  const markets = allMarkets({ loanToken: ADDR.usdc() });
  let states = new Map<string, MarketState>();
  let cachedAt: number | null = null;
  let stale = false;
  let error: string | null = null;
  if (opts.live !== false) {
    try {
      const r = await marketStatesCached(markets);
      states = r.value;
      cachedAt = r.cachedAt;
      stale = r.stale;
    } catch (err) {
      // Never echo the raw RPC error: it carries the provider URL.
      console.error("[markets] live read failed:", (err as Error).message);
      error = "live rates unavailable (RPC unreachable); showing the last snapshot";
    }
  }
  const minLiq = opts.minLiquidityUsd ?? MIN_LIQUIDITY_USD;
  const rows = markets.map((m) => toRow(m, states.get(m.id)));
  const groups = new Map<string, RateGroup>();
  for (const r of rows) {
    const k = r.collateral.address.toLowerCase();
    if (!groups.has(k)) groups.set(k, { collateral: r.collateral, best: null, rows: [] });
    groups.get(k)!.rows.push(r);
  }
  const out: RateGroup[] = [];
  for (const g of groups.values()) {
    // An oracle that disagrees with the rest of its group by more than half is broken
    // (one WETH market on Robinhood Chain reported 1e12): its row is kept, flagged, and
    // never offered as best.
    const prices = g.rows.map((r) => r.collateralPrice).filter((p): p is number => p !== null && p > 0).sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
    for (const r of g.rows) {
      r.oracleSuspect = median !== null && r.collateralPrice !== null && prices.length > 1 && Math.abs(r.collateralPrice / median - 1) > 0.5;
    }
    // cheapest first; within a basis point of each other, the deeper market wins (a
    // borrower would rather have room than a hundredth of a percent)
    g.rows.sort((a, b) => {
      const da = a.borrowApy ?? Infinity, db = b.borrowApy ?? Infinity;
      return Math.abs(da - db) < 0.0001 ? b.liquidityUsd - a.liquidityUsd : da - db;
    });
    g.best = g.rows.find((r) => r.borrowApy !== null && r.liquidityUsd >= minLiq && !r.oracleSuspect) ?? null;
    out.push(g);
  }
  // Biggest markets first: sum of supply across the group.
  out.sort((a, b) => sum(b.rows, (r) => r.totalSupplyUsd) - sum(a.rows, (r) => r.totalSupplyUsd));
  return {
    snapshot: snapshotInfo(),
    live: states.size > 0,
    statesCachedAt: cachedAt ? new Date(cachedAt).toISOString() : null,
    stale,
    error,
    minLiquidityUsd: minLiq,
    groups: out,
    rows,
  };
}

function sum<T>(xs: T[], f: (x: T) => number) {
  return xs.reduce((a, x) => a + f(x), 0);
}

export type Opportunity = {
  from: RateRow;
  to: RateRow;
  debtUsd: number;
  /** yearly interest saved at today's rates */
  savingsPerYearUsd: number;
  savingsBps: number;
  /** does the target have the liquidity for this debt */
  hasLiquidity: boolean;
  /** LTV the position would have there (same collateral, target oracle) */
  ltvAfter: number | null;
  /** target lltv keeps the position healthy with margin */
  healthy: boolean;
};

/**
 * For a position of `debt` USDC against `collateral` units in market `fromId`: the
 * cheaper markets of the same pair that could take it, best first.
 */
export async function opportunitiesFor(args: { fromId: string; debtUsd: number; collateralUnits: number; minSavingsBps?: number; marginBps?: number }): Promise<{ from: RateRow; opportunities: Opportunity[] }> {
  const from = allMarkets().find((m) => m.id.toLowerCase() === args.fromId.toLowerCase());
  if (!from) throw new ApiError(404, "unknown market");
  const pair = marketsForPair(from.params.collateralToken, from.params.loanToken);
  const { value: states } = await marketStatesCached(pair);
  const fromRow = toRow(from, states.get(from.id));
  const minSavings = (args.minSavingsBps ?? 30) / 10_000;
  const margin = (args.marginBps ?? 500) / 10_000;
  const out: Opportunity[] = [];
  for (const m of pair) {
    if (m.id === from.id) continue;
    const row = toRow(m, states.get(m.id));
    if (row.borrowApy === null || fromRow.borrowApy === null) continue;
    const saving = fromRow.borrowApy - row.borrowApy;
    if (saving < minSavings) continue;
    const collValue = row.collateralPrice !== null ? args.collateralUnits * row.collateralPrice : null;
    const ltvAfter = collValue && collValue > 0 ? args.debtUsd / collValue : null;
    out.push({
      from: fromRow,
      to: row,
      debtUsd: args.debtUsd,
      savingsPerYearUsd: args.debtUsd * saving,
      savingsBps: Math.round(saving * 10_000),
      hasLiquidity: row.liquidityUsd >= args.debtUsd,
      ltvAfter,
      healthy: ltvAfter !== null && ltvAfter <= row.lltv - margin,
    });
  }
  out.sort((a, b) => b.savingsBps - a.savingsBps);
  return { from: fromRow, opportunities: out };
}
