import { ethers } from "ethers";
import { ADDR, cached, decode, factoryContract, factoryIface, getProvider, multicall, vaultIface, type Call } from "../chain";
import { marketById, marketsForPair, readMarketStates, type MarketMeta } from "../morpho";
import { amountsForLiquidity, erc20Iface, poolsForPair, readPositions, uncollectedFees, tickToPriceRaw, sqrtToPriceRaw, type PoolInfo } from "../uniswap";
import { tokenMeta } from "../tokenmeta";
import { ApiError } from "../http";

/**
 * Everything a vault page shows, from one Multicall3 pass plus the position manager
 * and pool reads it points at. Numbers are returned both raw (strings) and in human
 * units; USD uses the loan token as $1 and the market oracle for the collateral.
 */

export type VaultSummary = {
  address: string;
  owner: string;
  operator: string;
  pendingOwner: string;
  paused: boolean;
  createdAt: number;
  collateral: { address: string; symbol: string; decimals: number; isStock: boolean };
  loan: { address: string; symbol: string; decimals: number };
  market: { id: string; lltv: number; params: MarketMeta["params"]; borrowApy: number | null; known: boolean };
  policy: { maxLtvBps: number; triggerLtvBps: number; repayBps: number; maxSlippageBps: number };
  position: {
    collateralRaw: string; collateral: number; collateralUsd: number | null;
    debtRaw: string; debt: number;
    ltvBps: number | null; ltv: number | null;
    /** distance to the market's liquidation threshold, in LTV points */
    liquidationLtv: number;
    healthFactor: number | null;
    /** collateral price (loan per token) at which the position is liquidated */
    liquidationPrice: number | null;
    collateralPrice: number | null;
  };
  balances: { loanRaw: string; loan: number; collateralRaw: string; collateral: number };
  stats: { totalBorrowed: number; totalRepaid: number; totalRepaidFromFees: number; totalHarvested: number; totalProtocolFees: number; refinanceCount: number };
  lp: LpPositionView[];
  lpValueUsd: number | null;
  /** everything the vault holds, $ */
  netValueUsd: number | null;
  allowedMarkets: string[];
};

export type LpPositionView = {
  tokenId: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  inRange: boolean;
  /** human, loan per collateral */
  priceLower: number | null;
  priceUpper: number | null;
  currentPrice: number | null;
  amountCollateral: number;
  amountLoan: number;
  valueUsd: number | null;
  uncollected: { collateral: number; loan: number; usd: number | null } | null;
  costBasis: number;
  pool: string | null;
};

const POLICY_KEYS = ["maxLtvBps", "triggerLtvBps", "repayBps", "maxSlippageBps"] as const;

function n(x: bigint, dec: number) {
  return Number(ethers.formatUnits(x, dec));
}

export async function listVaults(owner?: string): Promise<{ vaults: string[]; count: number }> {
  const f = factoryContract();
  if (owner) {
    if (!ethers.isAddress(owner)) throw new ApiError(400, "owner is not an address");
    const v: string[] = await f.vaultsOfOwner(owner);
    return { vaults: [...v], count: v.length };
  }
  const count = Number(await f.vaultCount());
  const v: string[] = count ? await f.vaults(0, Math.min(count, 500)) : [];
  return { vaults: [...v], count };
}

export async function isVault(address: string): Promise<boolean> {
  try {
    return await factoryContract().isVault(address);
  } catch {
    return false;
  }
}

/** One vault, fully read. */
export async function vaultSummary(address: string): Promise<VaultSummary> {
  if (!ethers.isAddress(address)) throw new ApiError(400, "vault is not an address");
  if (!(await isVault(address))) throw new ApiError(404, "not a Payoff vault");

  const fns = [
    "owner", "operator", "pendingOwner", "paused", "createdAt", "collateralToken", "loanToken", "currentMarket", "policy",
    "debtAssets", "collateralAssets", "ltvBps", "oraclePrice", "openPositions",
    "totalBorrowed", "totalRepaid", "totalRepaidFromFees", "totalHarvested", "totalProtocolFees", "refinanceCount",
  ];
  const calls: Call[] = fns.map((f) => ({ target: address, callData: vaultIface.encodeFunctionData(f) }));
  const res = await multicall(calls);
  const get = (i: number) => decode(vaultIface, fns[i], res[i]);
  const r = fns.map((_, i) => get(i));
  if (r.some((x) => x === null)) throw new ApiError(502, "vault read failed");

  const owner = r[0]![0] as string;
  const collateralToken = r[5]![0] as string;
  const loanToken = r[6]![0] as string;
  const mp = r[7]![0];
  const params = { loanToken: mp[0] as string, collateralToken: mp[1] as string, oracle: mp[2] as string, irm: mp[3] as string, lltv: BigInt(mp[4]).toString() };
  const marketId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address", "uint256"], [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]));
  const pol = r[8]!;
  const policy = Object.fromEntries(POLICY_KEYS.map((k, i) => [k, Number(pol[i])])) as VaultSummary["policy"];

  const collMeta = tokenMeta(collateralToken);
  const loanMeta = tokenMeta(loanToken);
  const collDec = collMeta?.decimals ?? 18;
  const loanDec = loanMeta?.decimals ?? 6;

  const debtRaw = BigInt(r[9]![0]);
  const collRaw = BigInt(r[10]![0]);
  const ltvRaw = BigInt(r[11]![0]);
  const oraclePx = BigInt(r[12]![0]);
  const openIds: bigint[] = [...(r[13]![0] as bigint[])].map((x) => BigInt(x));

  const price = oraclePx === 0n ? null : Number(ethers.formatUnits(oraclePx, 36 + loanDec - collDec));
  const debt = n(debtRaw, loanDec);
  const collateral = n(collRaw, collDec);
  const collateralUsd = price === null ? null : collateral * price;
  const ltvBps = ltvRaw === ethers.MaxUint256 ? null : Number(ltvRaw);
  const lltv = Number(params.lltv) / 1e18;
  const ltv = ltvBps === null ? null : ltvBps / 10_000;
  const healthFactor = debt === 0 ? null : collateralUsd && collateralUsd > 0 ? (collateralUsd * lltv) / debt : null;
  const liquidationPrice = debt === 0 || collateral === 0 ? null : debt / (collateral * lltv);

  // market rate (live)
  const meta = marketById(marketId);
  let borrowApy: number | null = null;
  const metaOrSynth: MarketMeta = meta ?? {
    id: marketId, params, listed: false, createdAt: null,
    loan: { symbol: loanMeta?.symbol ?? "LOAN", decimals: loanDec, name: null },
    collateral: { symbol: collMeta?.symbol ?? "COLL", decimals: collDec, name: null },
    snapshotState: null,
  };
  try {
    const st = await readMarketStates([metaOrSynth]);
    borrowApy = st.get(marketId)?.borrowApy ?? null;
  } catch { /* rate shown as unknown */ }

  // balances + allowed markets for the pair
  const pair = marketsForPair(collateralToken, loanToken);
  const extra: Call[] = [
    { target: loanToken, callData: erc20Iface.encodeFunctionData("balanceOf", [address]) },
    { target: collateralToken, callData: erc20Iface.encodeFunctionData("balanceOf", [address]) },
    ...pair.map((m) => ({ target: address, callData: vaultIface.encodeFunctionData("allowedMarkets", [m.id]) })),
    ...openIds.map((id) => ({ target: address, callData: vaultIface.encodeFunctionData("positionInfo", [id]) })),
  ];
  const ex = await multicall(extra);
  const loanBal = BigInt(decode(erc20Iface, "balanceOf", ex[0])?.[0] ?? 0);
  const collBal = BigInt(decode(erc20Iface, "balanceOf", ex[1])?.[0] ?? 0);
  const allowedMarkets = pair.filter((_, i) => decode(vaultIface, "allowedMarkets", ex[2 + i])?.[0] === true).map((m) => m.id);
  const costBasis = new Map<string, number>();
  openIds.forEach((id, i) => {
    const info = decode(vaultIface, "positionInfo", ex[2 + pair.length + i]);
    if (info) costBasis.set(id.toString(), n(BigInt(info[0][2]), loanDec));
  });

  // LP positions
  const lp = await lpViews(address, openIds, collateralToken, loanToken, collDec, loanDec, price, costBasis);
  const lpValueUsd = lp.length ? lp.reduce((a, p) => a + (p.valueUsd ?? 0) + (p.uncollected?.usd ?? 0), 0) : 0;
  const balancesUsd = n(loanBal, loanDec) + (price === null ? 0 : n(collBal, collDec) * price);
  const netValueUsd = collateralUsd === null && price === null ? null : (collateralUsd ?? 0) + lpValueUsd + balancesUsd - debt;

  return {
    address: ethers.getAddress(address),
    owner,
    operator: r[1]![0] as string,
    pendingOwner: r[2]![0] as string,
    paused: r[3]![0] as boolean,
    createdAt: Number(r[4]![0]),
    collateral: { address: collateralToken, symbol: collMeta?.symbol ?? "?", decimals: collDec, isStock: collMeta?.isStock ?? false },
    loan: { address: loanToken, symbol: loanMeta?.symbol ?? "?", decimals: loanDec },
    market: { id: marketId, lltv, params, borrowApy, known: !!meta },
    policy,
    position: {
      collateralRaw: collRaw.toString(), collateral, collateralUsd,
      debtRaw: debtRaw.toString(), debt,
      ltvBps, ltv, liquidationLtv: lltv, healthFactor, liquidationPrice, collateralPrice: price,
    },
    balances: { loanRaw: loanBal.toString(), loan: n(loanBal, loanDec), collateralRaw: collBal.toString(), collateral: n(collBal, collDec) },
    stats: {
      totalBorrowed: n(BigInt(r[14]![0]), loanDec),
      totalRepaid: n(BigInt(r[15]![0]), loanDec),
      totalRepaidFromFees: n(BigInt(r[16]![0]), loanDec),
      totalHarvested: n(BigInt(r[17]![0]), loanDec),
      totalProtocolFees: n(BigInt(r[18]![0]), loanDec),
      refinanceCount: Number(r[19]![0]),
    },
    lp,
    lpValueUsd,
    netValueUsd,
    allowedMarkets,
  };
}

async function lpViews(
  vault: string, ids: bigint[], collateralToken: string, loanToken: string, collDec: number, loanDec: number, price: number | null, costBasis: Map<string, number>
): Promise<LpPositionView[]> {
  if (ids.length === 0) return [];
  const [positions, pools] = await Promise.all([readPositions(ids), poolsForPair(collateralToken, loanToken, collDec, loanDec)]);
  const byFee = new Map<number, PoolInfo>(pools.map((p) => [p.fee, p]));
  const out: LpPositionView[] = [];
  for (const id of ids) {
    const p = positions.get(id.toString());
    if (!p) continue;
    const pool = byFee.get(p.fee) ?? null;
    const token0IsCollateral = p.token0.toLowerCase() === collateralToken.toLowerCase();
    const scale = Math.pow(10, collDec - loanDec);
    const toHuman = (raw: number) => (token0IsCollateral ? raw * scale : (1 / raw) * scale);
    let amountCollateral = 0, amountLoan = 0, inRange = false, currentPrice: number | null = null;
    if (pool) {
      const sqrt = BigInt(pool.sqrtPriceX96);
      const a = amountsForLiquidity(BigInt(p.liquidity), sqrt, p.tickLower, p.tickUpper);
      amountCollateral = (token0IsCollateral ? a.amount0 : a.amount1) / Math.pow(10, collDec);
      amountLoan = (token0IsCollateral ? a.amount1 : a.amount0) / Math.pow(10, loanDec);
      inRange = pool.tick >= p.tickLower && pool.tick < p.tickUpper;
      currentPrice = pool.price ?? (sqrt === 0n ? null : toHuman(sqrtToPriceRaw(sqrt)));
    }
    const pl = toHuman(tickToPriceRaw(p.tickLower));
    const pu = toHuman(tickToPriceRaw(p.tickUpper));
    const fees = await uncollectedFees(id, vault);
    const unc = fees
      ? {
          collateral: Number(ethers.formatUnits(token0IsCollateral ? fees.amount0 : fees.amount1, collDec)),
          loan: Number(ethers.formatUnits(token0IsCollateral ? fees.amount1 : fees.amount0, loanDec)),
          usd: null as number | null,
        }
      : null;
    if (unc) unc.usd = price === null ? unc.loan : unc.loan + unc.collateral * price;
    out.push({
      tokenId: id.toString(),
      fee: p.fee,
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      liquidity: p.liquidity,
      inRange,
      priceLower: Math.min(pl, pu),
      priceUpper: Math.max(pl, pu),
      currentPrice,
      amountCollateral,
      amountLoan,
      valueUsd: price === null ? null : amountLoan + amountCollateral * price,
      uncollected: unc,
      costBasis: costBasis.get(id.toString()) ?? 0,
      pool: pool?.address ?? null,
    });
  }
  return out;
}

/** Light rows for lists and the leaderboard: one multicall for many vaults. */
export type VaultRow = {
  address: string; owner: string; operator: string; paused: boolean; createdAt: number;
  collateral: { address: string; symbol: string; isStock: boolean }; loan: { address: string; symbol: string };
  debt: number; collateral_: number; collateralUsd: number | null; ltvBps: number | null; lltv: number;
  totalRepaidFromFees: number; totalHarvested: number; refinanceCount: number; openPositions: number;
};

export async function vaultRows(addresses: string[]): Promise<VaultRow[]> {
  if (addresses.length === 0) return [];
  const fns = ["owner", "operator", "paused", "createdAt", "collateralToken", "loanToken", "currentMarket", "debtAssets", "collateralAssets", "ltvBps", "oraclePrice", "totalRepaidFromFees", "totalHarvested", "refinanceCount", "openPositions"];
  const calls: Call[] = [];
  for (const a of addresses) for (const f of fns) calls.push({ target: a, callData: vaultIface.encodeFunctionData(f) });
  const res = await multicall(calls);
  const out: VaultRow[] = [];
  addresses.forEach((a, i) => {
    const g = (j: number) => decode(vaultIface, fns[j], res[i * fns.length + j]);
    const vals = fns.map((_, j) => g(j));
    if (vals.some((v) => v === null)) return;
    const collateralToken = vals[4]![0] as string;
    const loanToken = vals[5]![0] as string;
    const cm = tokenMeta(collateralToken);
    const lm = tokenMeta(loanToken);
    const collDec = cm?.decimals ?? 18;
    const loanDec = lm?.decimals ?? 6;
    const px = BigInt(vals[10]![0]);
    const price = px === 0n ? null : Number(ethers.formatUnits(px, 36 + loanDec - collDec));
    const coll = n(BigInt(vals[8]![0]), collDec);
    const ltvRaw = BigInt(vals[9]![0]);
    out.push({
      address: ethers.getAddress(a),
      owner: vals[0]![0], operator: vals[1]![0], paused: vals[2]![0], createdAt: Number(vals[3]![0]),
      collateral: { address: collateralToken, symbol: cm?.symbol ?? "?", isStock: cm?.isStock ?? false },
      loan: { address: loanToken, symbol: lm?.symbol ?? "?" },
      debt: n(BigInt(vals[7]![0]), loanDec),
      collateral_: coll,
      collateralUsd: price === null ? null : coll * price,
      ltvBps: ltvRaw === ethers.MaxUint256 ? null : Number(ltvRaw),
      lltv: Number(BigInt(vals[6]![0][4])) / 1e18,
      totalRepaidFromFees: n(BigInt(vals[11]![0]), loanDec),
      totalHarvested: n(BigInt(vals[12]![0]), loanDec),
      refinanceCount: Number(vals[13]![0]),
      openPositions: (vals[14]![0] as unknown[]).length,
    });
  });
  return out;
}

/** Block the factory was deployed at (env) or the first VaultCreated we can find. */
export function factoryStartBlock(): number {
  return Number(process.env.PAYOFF_FACTORY_START_BLOCK ?? 0);
}

/** The block a vault was created in, from the factory's VaultCreated log (cached forever). */
export async function vaultCreationBlock(vault: string): Promise<number | null> {
  const { value } = await cached(`created:${vault.toLowerCase()}`, 24 * 3600_000, async () => {
    const f = ADDR.factory();
    const topic = factoryIface.getEvent("VaultCreated")!.topicHash;
    const latest = await getProvider().getBlockNumber();
    const { getLogsChunked } = await import("../chain");
    const logs = await getLogsChunked({ address: f, topics: [topic, ethers.zeroPadValue(vault, 32)] }, factoryStartBlock(), latest);
    return logs[0]?.blockNumber ?? null;
  });
  return value;
}
