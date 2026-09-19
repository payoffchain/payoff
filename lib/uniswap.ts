import { ethers } from "ethers";
import { ADDR, BLOCKS_PER_DAY, cached, decode, getLogsChunked, getLogsRecent, getProvider, multicall, type Call } from "./chain";

/**
 * Uniswap V3 on Robinhood Chain: pool discovery for a pair, tick maths for range
 * selection, position valuation, and a fee-yield estimate from recent swap volume.
 *
 * The RPC is not an archive node, so historic fee-growth cannot be read back; the
 * fee estimate comes from Swap events over the last `hours`, and says so.
 */

export const FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

export const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
export const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
];
export const NFPM_ABI = [
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) returns (uint256 amount0, uint256 amount1)",
];
export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

export const factoryIface = new ethers.Interface(FACTORY_ABI);
export const poolIface = new ethers.Interface(POOL_ABI);
export const nfpmIface = new ethers.Interface(NFPM_ABI);
export const erc20Iface = new ethers.Interface(ERC20_ABI);

export const TICK_SPACING: Record<number, number> = { 100: 1, 500: 10, 3000: 60, 10000: 200 };
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
const Q96 = 2 ** 96;

export function sortTokens(a: string, b: string): [string, string] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

// --- tick maths (floating point: for range selection and display; the contract uses the chain's own numbers) ---

/** token1 per token0 in RAW units from sqrtPriceX96. */
export function sqrtToPriceRaw(sqrtPriceX96: bigint): number {
  const s = Number(sqrtPriceX96) / Q96;
  return s * s;
}

export function tickToPriceRaw(tick: number): number {
  return Math.pow(1.0001, tick);
}

export function priceRawToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

export function tickToSqrtPriceX96(tick: number): bigint {
  return BigInt(Math.floor(Math.sqrt(Math.pow(1.0001, tick)) * Q96));
}

export function alignTick(tick: number, spacing: number, dir: "down" | "up"): number {
  const t = dir === "down" ? Math.floor(tick / spacing) * spacing : Math.ceil(tick / spacing) * spacing;
  return Math.max(MIN_TICK, Math.min(MAX_TICK, t));
}

/**
 * A symmetric range `widthPct` either side of the current tick, aligned to the tier's
 * spacing. Full range when widthPct <= 0.
 */
export function rangeAround(tick: number, widthPct: number, fee: number): { tickLower: number; tickUpper: number } {
  const spacing = TICK_SPACING[fee] ?? 60;
  if (widthPct <= 0) return { tickLower: alignTick(MIN_TICK, spacing, "up"), tickUpper: alignTick(MAX_TICK, spacing, "down") };
  const ticks = Math.round(Math.log(1 + widthPct / 100) / Math.log(1.0001));
  let lower = alignTick(tick - ticks, spacing, "down");
  let upper = alignTick(tick + ticks, spacing, "up");
  if (upper <= lower) upper = lower + spacing;
  return { tickLower: lower, tickUpper: upper };
}

/** Amounts of token0/token1 a position of `liquidity` holds at `sqrtP` (raw units, floating). */
export function amountsForLiquidity(liquidity: bigint, sqrtPriceX96: bigint, tickLower: number, tickUpper: number): { amount0: number; amount1: number } {
  const L = Number(liquidity);
  const sp = Number(sqrtPriceX96) / Q96;
  const sa = Math.sqrt(Math.pow(1.0001, tickLower));
  const sb = Math.sqrt(Math.pow(1.0001, tickUpper));
  if (sp <= sa) return { amount0: (L * (sb - sa)) / (sa * sb), amount1: 0 };
  if (sp >= sb) return { amount0: 0, amount1: L * (sb - sa) };
  return { amount0: (L * (sb - sp)) / (sp * sb), amount1: L * (sp - sa) };
}

/**
 * Convert a raw-unit token1/token0 price into a human "loan per collateral" number
 * given which side is which and their decimals.
 */
export function humanPrice(priceRaw: number, token0IsCollateral: boolean, collDec: number, loanDec: number): number {
  // priceRaw = token1_raw / token0_raw
  if (token0IsCollateral) return priceRaw * Math.pow(10, collDec - loanDec);
  return (1 / priceRaw) * Math.pow(10, collDec - loanDec);
}

// --- pools -----------------------------------------------------------------------

export type PoolInfo = {
  address: string;
  fee: number;
  tickSpacing: number;
  token0: string;
  token1: string;
  sqrtPriceX96: string;
  tick: number;
  liquidity: string;
  /** loan per collateral (human units) */
  price: number | null;
  /** token balances held by the pool, raw */
  balance0: string;
  balance1: string;
  /** USD value of the pool's token balances, using loan token = $1 and `price` */
  tvlUsd: number | null;
};

/** Every existing pool for a pair, with live state. */
export async function poolsForPair(collateralToken: string, loanToken: string, collDec: number, loanDec: number): Promise<PoolInfo[]> {
  const [t0, t1] = sortTokens(collateralToken, loanToken);
  const token0IsCollateral = t0.toLowerCase() === collateralToken.toLowerCase();
  const uniFactory = ADDR.uniFactory();
  const found = await multicall(FEE_TIERS.map((fee) => ({ target: uniFactory, callData: factoryIface.encodeFunctionData("getPool", [t0, t1, fee]) })));
  const pools: Array<{ fee: number; address: string }> = [];
  FEE_TIERS.forEach((fee, i) => {
    const r = decode(factoryIface, "getPool", found[i]);
    if (r && r[0] !== ethers.ZeroAddress) pools.push({ fee, address: r[0] });
  });
  if (pools.length === 0) return [];

  const calls: Call[] = [];
  for (const p of pools) {
    calls.push({ target: p.address, callData: poolIface.encodeFunctionData("slot0") });
    calls.push({ target: p.address, callData: poolIface.encodeFunctionData("liquidity") });
    calls.push({ target: p.address, callData: poolIface.encodeFunctionData("tickSpacing") });
    calls.push({ target: t0, callData: erc20Iface.encodeFunctionData("balanceOf", [p.address]) });
    calls.push({ target: t1, callData: erc20Iface.encodeFunctionData("balanceOf", [p.address]) });
  }
  const res = await multicall(calls);
  const out: PoolInfo[] = [];
  pools.forEach((p, i) => {
    const slot0 = decode(poolIface, "slot0", res[i * 5]);
    const liq = decode(poolIface, "liquidity", res[i * 5 + 1]);
    const spacing = decode(poolIface, "tickSpacing", res[i * 5 + 2]);
    const b0 = decode(erc20Iface, "balanceOf", res[i * 5 + 3]);
    const b1 = decode(erc20Iface, "balanceOf", res[i * 5 + 4]);
    if (!slot0 || !liq) return;
    const sqrt = BigInt(slot0[0]);
    const price = sqrt === 0n ? null : humanPrice(sqrtToPriceRaw(sqrt), token0IsCollateral, collDec, loanDec);
    const bal0 = b0 ? BigInt(b0[0]) : 0n;
    const bal1 = b1 ? BigInt(b1[0]) : 0n;
    let tvlUsd: number | null = null;
    if (price !== null) {
      const collBal = token0IsCollateral ? bal0 : bal1;
      const loanBal = token0IsCollateral ? bal1 : bal0;
      tvlUsd = Number(ethers.formatUnits(loanBal, loanDec)) + Number(ethers.formatUnits(collBal, collDec)) * price;
    }
    out.push({
      address: p.address,
      fee: p.fee,
      tickSpacing: spacing ? Number(spacing[0]) : TICK_SPACING[p.fee] ?? 60,
      token0: t0,
      token1: t1,
      sqrtPriceX96: sqrt.toString(),
      tick: Number(slot0[1]),
      liquidity: BigInt(liq[0]).toString(),
      price,
      balance0: bal0.toString(),
      balance1: bal1.toString(),
      tvlUsd,
    });
  });
  return out;
}

const volumeFailedAt = new Map<string, number>();

export type PoolVolume = {
  hours: number;
  swaps: number;
  /** volume in loan-token units (human) */
  volumeLoan: number;
  /** fees the pool paid LPs over the window, loan units */
  feesLoan: number;
  /** annualised fees / tvl; null without tvl */
  feeApr: number | null;
  fromBlock: number;
  toBlock: number;
  /** true when the time budget ran out: `hours` is then the window actually read */
  partial?: boolean;
};

const VOLUME_BUDGET_MS = Number(process.env.POOL_VOLUME_BUDGET_MS ?? 12_000);

/**
 * Swap volume over the last `hours` from the pool's Swap events, and the fee yield it
 * implies for the pool as a whole (a concentrated position in range earns more per
 * dollar; one out of range earns nothing — this is the floor a full-range LP would see).
 */
export async function poolVolume(pool: PoolInfo, loanIsToken0: boolean, loanDec: number, hours: number, tvlUsd: number | null): Promise<PoolVolume | null> {
  const key = `vol:${pool.address}:${hours}`;
  if ((volumeFailedAt.get(key) ?? 0) > Date.now() - 60_000) return null;
  try {
    const { value } = await cached(key, 10 * 60_000, () => readPoolVolume(pool, loanIsToken0, loanDec, hours, tvlUsd));
    return value;
  } catch {
    // A pool too busy for the RPC's log query is reported as "unknown", not as an error
    // page, and not retried through the whole halving ladder on every request.
    volumeFailedAt.set(key, Date.now());
    return null;
  }
}

async function readPoolVolume(pool: PoolInfo, loanIsToken0: boolean, loanDec: number, hours: number, tvlUsd: number | null): Promise<PoolVolume> {
  {
    const provider = getProvider();
    const toBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, toBlock - Math.round((BLOCKS_PER_DAY * hours) / 24));
    const topic = poolIface.getEvent("Swap")!.topicHash;
    // Newest first, inside a time budget. A busy pool over a slow RPC used to run the
    // whole halving ladder and take the route (and the RPC, for every other request)
    // down with it. What the budget reaches is what gets measured: the window shrinks
    // to the blocks actually read, and the yield is annualized from that.
    const scan = await getLogsRecent({ address: pool.address, topics: [topic] }, fromBlock, toBlock, { budgetMs: VOLUME_BUDGET_MS, chunk: 25_000 });
    const logs = scan.logs;
    const covered = toBlock - scan.scannedFrom + 1;
    if (covered <= 0) throw new Error("no block of the window could be read");
    if (scan.partial) hours = Math.max(covered / (BLOCKS_PER_DAY / 24), 1 / 60);
    let volume = 0n;
    for (const l of logs) {
      const ev = poolIface.parseLog({ topics: l.topics as string[], data: l.data });
      if (!ev) continue;
      const amt = BigInt(loanIsToken0 ? ev.args.amount0 : ev.args.amount1);
      volume += amt < 0n ? -amt : amt;
    }
    const volumeLoan = Number(ethers.formatUnits(volume, loanDec));
    const feesLoan = (volumeLoan * pool.fee) / 1e6;
    const feeApr = tvlUsd && tvlUsd > 0 ? (feesLoan * (24 / hours) * 365) / tvlUsd : null;
    return { hours, swaps: logs.length, volumeLoan, feesLoan, feeApr, fromBlock: scan.scannedFrom, toBlock, partial: scan.partial } as PoolVolume;
  }
}

// --- positions -------------------------------------------------------------------

export type NftPosition = {
  tokenId: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
};

export async function readPositions(tokenIds: bigint[]): Promise<Map<string, NftPosition>> {
  const out = new Map<string, NftPosition>();
  if (tokenIds.length === 0) return out;
  const pm = ADDR.positionManager();
  const res = await multicall(tokenIds.map((id) => ({ target: pm, callData: nfpmIface.encodeFunctionData("positions", [id]) })));
  tokenIds.forEach((id, i) => {
    const r = decode(nfpmIface, "positions", res[i]);
    if (!r) return;
    out.set(id.toString(), {
      tokenId: id.toString(),
      token0: r.token0,
      token1: r.token1,
      fee: Number(r.fee),
      tickLower: Number(r.tickLower),
      tickUpper: Number(r.tickUpper),
      liquidity: BigInt(r.liquidity).toString(),
      tokensOwed0: BigInt(r.tokensOwed0).toString(),
      tokensOwed1: BigInt(r.tokensOwed1).toString(),
    });
  });
  return out;
}

/**
 * Fees a position could collect right now. `tokensOwed` on the manager only updates
 * when the position is poked, so this simulates `collect` from the owner's address
 * with eth_call — no state change, exact number.
 */
export async function uncollectedFees(tokenId: bigint, owner: string): Promise<{ amount0: bigint; amount1: bigint } | null> {
  try {
    const pm = ADDR.positionManager();
    const data = nfpmIface.encodeFunctionData("collect", [[tokenId, owner, (1n << 128n) - 1n, (1n << 128n) - 1n]]);
    const ret = await getProvider().call({ to: pm, from: owner, data });
    const r = nfpmIface.decodeFunctionResult("collect", ret);
    return { amount0: BigInt(r[0]), amount1: BigInt(r[1]) };
  } catch {
    return null;
  }
}
