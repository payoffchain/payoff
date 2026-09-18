import { ethers } from "ethers";
import { ADDR, cached, decode, multicall, type Call } from "./chain";
import snapshot from "./morpho-markets.json";

/**
 * Morpho Blue on Robinhood Chain.
 *
 * Market PARAMS (tokens, oracle, irm, lltv) never change once a market exists, so they
 * come from a snapshot that scripts/sync-markets.mjs refreshes from the Morpho API. Market
 * STATE (totals, rates, utilization) is read on chain through Multicall3 every time: that
 * is what a refinance decision is made on, and it must not be a cached API number.
 *
 * Rates: the IRM returns a per-second borrow rate scaled 1e18; APY = e^(rate * year) - 1.
 * Supply APY = borrow APY * utilization * (1 - fee).
 */

export type MarketParams = { loanToken: string; collateralToken: string; oracle: string; irm: string; lltv: string };

export type MarketMeta = {
  id: string;
  params: MarketParams;
  listed: boolean;
  createdAt: number | null;
  loan: { symbol: string; decimals: number; name: string | null };
  collateral: { symbol: string; decimals: number; name: string | null };
  /** From the snapshot; the live numbers come from `readMarketStates`. */
  snapshotState: { borrowApy: number | null; supplyApy: number | null; utilization: number | null; supplyUsd: number | null; borrowUsd: number | null; liquidityUsd: number | null; collateralUsd: number | null } | null;
};

export type MarketState = {
  id: string;
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: number;
  fee: bigint;
  /** loan units per collateral unit, scaled 1e36; null when the oracle reverted */
  oraclePrice: bigint | null;
  /** per-second, 1e18 */
  borrowRate: bigint | null;
  borrowApy: number | null;
  supplyApy: number | null;
  utilization: number;
  liquidity: bigint;
};

const SECONDS_PER_YEAR = 365 * 24 * 3600;
const WAD = 10n ** 18n;

export const MORPHO_ABI = [
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
];
export const ORACLE_ABI = ["function price() view returns (uint256)"];
export const IRM_ABI = [
  "function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,(uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee) market) view returns (uint256)",
];

export const morphoIface = new ethers.Interface(MORPHO_ABI);
export const oracleIface = new ethers.Interface(ORACLE_ABI);
export const irmIface = new ethers.Interface(IRM_ABI);

export function marketIdOf(p: MarketParams): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address", "uint256"], [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv])
  );
}

type SnapshotMarket = (typeof snapshot)["markets"][number];

function fromSnapshot(m: SnapshotMarket): MarketMeta {
  return {
    id: m.id,
    params: { loanToken: m.loanToken, collateralToken: m.collateralToken, oracle: m.oracle ?? ethers.ZeroAddress, irm: m.irm, lltv: m.lltv },
    listed: m.listed,
    createdAt: m.createdAt,
    loan: m.loan,
    collateral: m.collateral,
    snapshotState: m.state,
  };
}

export function snapshotInfo() {
  return { fetchedAt: snapshot.fetchedAt, count: snapshot.count, morpho: snapshot.morpho, chainId: snapshot.chainId };
}

/** All snapshot markets whose loan token is the numeraire (USDG by default). */
export function allMarkets(opts: { loanToken?: string } = {}): MarketMeta[] {
  const loan = (opts.loanToken ?? ADDR.usdg()).toLowerCase();
  return (snapshot.markets as SnapshotMarket[]).filter((m) => m.loanToken.toLowerCase() === loan && m.oracle).map(fromSnapshot);
}

export function marketById(id: string): MarketMeta | null {
  // A market without an oracle cannot price collateral; the snapshot keeps it for the
  // record but nothing here may build calldata against it.
  const m = (snapshot.markets as SnapshotMarket[]).find((x) => x.id.toLowerCase() === id.toLowerCase() && x.oracle);
  return m ? fromSnapshot(m) : null;
}

const ERC20_META_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const erc20MetaIface = new ethers.Interface(ERC20_META_ABI);

/**
 * The snapshot first; then the chain. A market created after the last sync-markets run
 * is still a real market, and a vault on it must not be a dead end. The on-chain read
 * is cached for the life of the instance because market params never change.
 */
export async function resolveMarket(id: string): Promise<MarketMeta | null> {
  const local = marketById(id);
  if (local) return local;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return null;
  const { value } = await cached(`market:${id.toLowerCase()}`, 24 * 3600_000, async () => {
    const morpho = ADDR.morpho();
    const res = await multicall([{ target: morpho, callData: morphoIface.encodeFunctionData("idToMarketParams", [id]) }]);
    const r = decode(morphoIface, "idToMarketParams", res[0]);
    if (!r || r[0] === ethers.ZeroAddress || r[2] === ethers.ZeroAddress) return null;
    const params: MarketParams = { loanToken: r[0], collateralToken: r[1], oracle: r[2], irm: r[3], lltv: BigInt(r[4]).toString() };
    const meta = await multicall([
      { target: params.loanToken, callData: erc20MetaIface.encodeFunctionData("decimals") },
      { target: params.loanToken, callData: erc20MetaIface.encodeFunctionData("symbol") },
      { target: params.collateralToken, callData: erc20MetaIface.encodeFunctionData("decimals") },
      { target: params.collateralToken, callData: erc20MetaIface.encodeFunctionData("symbol") },
    ]);
    const ld = decode(erc20MetaIface, "decimals", meta[0]);
    const ls = decode(erc20MetaIface, "symbol", meta[1]);
    const cd = decode(erc20MetaIface, "decimals", meta[2]);
    const cs = decode(erc20MetaIface, "symbol", meta[3]);
    if (!ld || !cd) return null;
    const out: MarketMeta = {
      id: id.toLowerCase(), params, listed: false, createdAt: null,
      loan: { symbol: ls ? String(ls[0]) : "LOAN", decimals: Number(ld[0]), name: null },
      collateral: { symbol: cs ? String(cs[0]) : "COLL", decimals: Number(cd[0]), name: null },
      snapshotState: null,
    };
    return out;
  });
  return value;
}

/** Markets that share a pair, i.e. the ones a vault of that pair may refinance between. */
export function marketsForPair(collateralToken: string, loanToken: string): MarketMeta[] {
  const c = collateralToken.toLowerCase();
  const l = loanToken.toLowerCase();
  return (snapshot.markets as SnapshotMarket[])
    .filter((m) => m.collateralToken.toLowerCase() === c && m.loanToken.toLowerCase() === l && m.oracle)
    .map(fromSnapshot);
}

export function ratePerSecondToApy(rate: bigint): number {
  const r = Number(rate) / 1e18;
  return Math.expm1(r * SECONDS_PER_YEAR);
}

/**
 * Live state for a set of markets in one Multicall3 round trip: market totals, the
 * oracle price and the IRM's current borrow rate (which needs the totals, so it is a
 * second round trip).
 */
export async function readMarketStates(markets: MarketMeta[]): Promise<Map<string, MarketState>> {
  const out = new Map<string, MarketState>();
  if (markets.length === 0) return out;
  const morpho = ADDR.morpho();

  const calls: Call[] = [];
  for (const m of markets) {
    calls.push({ target: morpho, callData: morphoIface.encodeFunctionData("market", [m.id]) });
    calls.push({ target: m.params.oracle, callData: oracleIface.encodeFunctionData("price") });
  }
  const res = await multicall(calls);

  const rateCalls: Call[] = [];
  const partial: Array<{ m: MarketMeta; mk: ethers.Result; price: bigint | null }> = [];
  markets.forEach((m, i) => {
    const mk = decode(morphoIface, "market", res[i * 2]);
    const px = decode(oracleIface, "price", res[i * 2 + 1]);
    if (!mk) return;
    partial.push({ m, mk, price: px ? BigInt(px[0]) : null });
    rateCalls.push({
      target: m.params.irm,
      callData: irmIface.encodeFunctionData("borrowRateView", [
        [m.params.loanToken, m.params.collateralToken, m.params.oracle, m.params.irm, m.params.lltv],
        [mk[0], mk[1], mk[2], mk[3], mk[4], mk[5]],
      ]),
    });
  });
  const rates = await multicall(rateCalls);

  partial.forEach(({ m, mk, price }, i) => {
    const rateRes = decode(irmIface, "borrowRateView", rates[i]);
    const totalSupplyAssets = BigInt(mk[0]);
    const totalBorrowAssets = BigInt(mk[2]);
    const fee = BigInt(mk[5]);
    const utilization = totalSupplyAssets === 0n ? 0 : Number((totalBorrowAssets * WAD) / totalSupplyAssets) / 1e18;
    const borrowRate = rateRes ? BigInt(rateRes[0]) : null;
    const borrowApy = borrowRate === null ? null : ratePerSecondToApy(borrowRate);
    const supplyApy = borrowApy === null ? null : borrowApy * utilization * (1 - Number(fee) / 1e18);
    out.set(m.id, {
      id: m.id,
      totalSupplyAssets,
      totalSupplyShares: BigInt(mk[1]),
      totalBorrowAssets,
      totalBorrowShares: BigInt(mk[3]),
      lastUpdate: Number(mk[4]),
      fee,
      oraclePrice: price,
      borrowRate,
      borrowApy,
      supplyApy,
      utilization,
      liquidity: totalSupplyAssets > totalBorrowAssets ? totalSupplyAssets - totalBorrowAssets : 0n,
    });
  });
  return out;
}

/** Cached for a short while: rate tables are read by every page. */
export async function marketStatesCached(markets: MarketMeta[], ttlMs = 15_000) {
  const key = "states:" + markets.map((m) => m.id.slice(2, 10)).sort().join(",");
  return cached(key, ttlMs, () => readMarketStates(markets));
}

/** USD value of `amount` (raw) of a market's collateral, using the market oracle and the loan token as $1. */
export function collateralValueInLoan(amount: bigint, oraclePrice: bigint): bigint {
  return (amount * oraclePrice) / 10n ** 36n;
}

export function toUnits(raw: bigint, decimals: number): number {
  return Number(ethers.formatUnits(raw, decimals));
}

/** Borrow shares -> assets, rounded up like Morpho does. */
export function sharesToAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const num = shares * (totalAssets + 1n);
  const den = totalShares + 1_000_000n;
  return (num + den - 1n) / den;
}
