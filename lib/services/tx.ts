import { ethers } from "ethers";
import { ADDR, factoryIface, getProvider, vaultIface } from "../chain";
import { marketsForPair, readMarketStates, resolveMarket } from "../morpho";
import { erc20Iface, poolsForPair, rangeAround, sortTokens, uncollectedFees } from "../uniswap";
import { tokenMeta } from "../tokenmeta";
import { decimalsOf, parseDecimal } from "../tokens";
import { ApiError } from "../http";
import { isVault } from "./vaults";

/**
 * Unsigned calldata for every vault action. The server signs nothing; it builds
 * { to, data, value } and the owner's wallet or the operator key signs it.
 *
 * Every builder that spends a token also reports the approval it needs, so a client
 * can put the approve first without guessing the spender.
 */

export type Tx = { to: string; data: string; value: string; description: string };
export type Approval = { token: string; spender: string; amount: string; symbol: string };
export type Built = { tx: Tx; approvals: Approval[]; deadline?: number; notes?: string[] };

export const DEFAULT_DEADLINE_SECONDS = 20 * 60;

export function deadlineFromNow(seconds = DEFAULT_DEADLINE_SECONDS): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

export type PolicyInput = { maxLtvBps: number; triggerLtvBps: number; repayBps: number; maxSlippageBps: number };

export const DEFAULT_POLICY: PolicyInput = { maxLtvBps: 5000, triggerLtvBps: 7000, repayBps: 2500, maxSlippageBps: 100 };

/** Mirrors PayoffVault._setPolicy exactly, so a bad policy fails here with a reason, not in the wallet. */
export function validPolicy(p: PolicyInput, lltvWad?: string | bigint) {
  for (const k of ["maxLtvBps", "triggerLtvBps", "repayBps", "maxSlippageBps"] as const) {
    if (!Number.isInteger(p[k]) || p[k] < 0) throw new ApiError(400, `${k} must be a non-negative integer`);
  }
  if (p.maxLtvBps > 9500) throw new ApiError(400, "maxLtvBps above 9500");
  if (p.triggerLtvBps < p.maxLtvBps || p.triggerLtvBps > 10_000) throw new ApiError(400, "triggerLtvBps must be between maxLtvBps and 10000");
  if (p.repayBps <= 0 || p.repayBps > 10_000) throw new ApiError(400, "repayBps must be 1..10000");
  if (p.maxSlippageBps < 10 || p.maxSlippageBps > 2000) throw new ApiError(400, "maxSlippageBps must be 10..2000");
  if (lltvWad !== undefined && BigInt(p.triggerLtvBps) * 10n ** 14n >= BigInt(lltvWad)) {
    throw new ApiError(400, `triggerLtvBps ${p.triggerLtvBps} must be below the market's LLTV (${Number(BigInt(lltvWad)) / 1e16}%), or protection can never fire before liquidation`);
  }
}

/** Uniswap V3 fee tiers a vault can name for its operator. */
export const FEE_TIERS = [100, 500, 3000, 10000] as const;

/**
 * Tiers the vault lets its operator use. null = a vault from before the allow-list
 * existed (the call reverts), which has no restriction to respect.
 */
export async function allowedFeesOf(vault: string): Promise<number[] | null> {
  const c = new ethers.Contract(vault, vaultIface, getProvider());
  try {
    const flags: boolean[] = await Promise.all(FEE_TIERS.map((f) => c.allowedFees(f)));
    return FEE_TIERS.filter((_, i) => flags[i]);
  } catch {
    return null;
  }
}

/** createVault(operator, initialMarket, policy, lpFees) on the factory. */
export async function buildCreateVault(args: { marketId: string; operator: string; policy?: PolicyInput; lpFees?: number[] }): Promise<Built> {
  const m = await resolveMarket(args.marketId);
  if (!m) throw new ApiError(404, "unknown market");
  if (!ethers.isAddress(args.operator)) throw new ApiError(400, "operator is not an address");
  const policy = args.policy ?? DEFAULT_POLICY;
  validPolicy(policy, m.params.lltv);
  const p = m.params;
  // Tiers the operator may use. By default: the pair's pools that exist, hold liquidity
  // and whose fee fits inside the slippage band. An empty tier is exactly what a leaked
  // operator key would want, so it is never offered; the owner can add tiers later.
  let lpFees = args.lpFees;
  if (!lpFees) {
    const pools = await poolsForPair(p.collateralToken, p.loanToken, m.collateral.decimals, m.loan.decimals);
    lpFees = pools.filter((x) => x.price !== null && (x.tvlUsd ?? 0) > 0 && x.fee / 100 < policy.maxSlippageBps).map((x) => x.fee);
  }
  if (lpFees.some((f) => !(FEE_TIERS as readonly number[]).includes(f))) throw new ApiError(400, `lpFees must be among ${FEE_TIERS.join(", ")}`);
  lpFees = [...new Set(lpFees)];
  const data = factoryIface.encodeFunctionData("createVault", [
    args.operator,
    [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv],
    [policy.maxLtvBps, policy.triggerLtvBps, policy.repayBps, policy.maxSlippageBps],
    lpFees,
  ]);
  return {
    tx: { to: ADDR.factory(), data, value: "0", description: `Create a ${m.collateral.symbol}/${m.loan.symbol} vault (LLTV ${(Number(p.lltv) / 1e16).toFixed(0)}%)` },
    approvals: [],
    notes: [
      "The vault address is emitted as VaultCreated(vault, owner, operator, ...); read it from the receipt.",
      lpFees.length
        ? `The agent may use the ${lpFees.map((f) => f / 10_000 + "%").join(", ")} pool${lpFees.length > 1 ? "s" : ""}; change this in the vault's settings.`
        : "No pool of this pair holds liquidity yet, so the agent starts with no fee tier allowed; allow one in the vault's settings.",
    ],
  };
}

type VaultCtx = { address: string; collateralToken: string; loanToken: string; collDec: number; loanDec: number; collSymbol: string; loanSymbol: string };

async function ctx(vault: string): Promise<VaultCtx> {
  if (!ethers.isAddress(vault)) throw new ApiError(400, "vault is not an address");
  if (!(await isVault(vault))) throw new ApiError(404, "not a Payoff vault");
  const c = new ethers.Contract(vault, vaultIface, getProvider());
  const [collateralToken, loanToken] = await Promise.all([c.collateralToken(), c.loanToken()]);
  const cm = tokenMeta(collateralToken);
  const lm = tokenMeta(loanToken);
  // Decimals go straight into calldata a wallet signs. A token the snapshot does not
  // know is read from the chain, never defaulted: "deposit 100" of a 6-decimal token
  // encoded as 18 decimals is a 10^12 mistake.
  const [collDec, loanDec] = await Promise.all([cm?.decimals ?? decimalsOf(collateralToken), lm?.decimals ?? decimalsOf(loanToken)]);
  return { address: ethers.getAddress(vault), collateralToken, loanToken, collDec, loanDec, collSymbol: cm?.symbol ?? "COLL", loanSymbol: lm?.symbol ?? "LOAN" };
}

export async function buildDepositCollateral(vault: string, amount: string): Promise<Built> {
  const v = await ctx(vault);
  const raw = parseDecimal(amount, v.collDec, "amount");
  return {
    tx: { to: v.address, data: vaultIface.encodeFunctionData("depositCollateral", [raw]), value: "0", description: `Deposit ${amount} ${v.collSymbol} as collateral` },
    approvals: [{ token: v.collateralToken, spender: v.address, amount: raw.toString(), symbol: v.collSymbol }],
  };
}

export async function buildDepositLoanToken(vault: string, amount: string): Promise<Built> {
  const v = await ctx(vault);
  const raw = parseDecimal(amount, v.loanDec, "amount");
  return {
    tx: { to: v.address, data: vaultIface.encodeFunctionData("depositLoanToken", [raw]), value: "0", description: `Deposit ${amount} ${v.loanSymbol} into the vault` },
    approvals: [{ token: v.loanToken, spender: v.address, amount: raw.toString(), symbol: v.loanSymbol }],
  };
}

export async function buildBorrow(vault: string, amount: string): Promise<Built> {
  const v = await ctx(vault);
  const raw = parseDecimal(amount, v.loanDec, "amount");
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("borrow", [raw]), value: "0", description: `Borrow ${amount} ${v.loanSymbol}` }, approvals: [] };
}

export async function buildRepay(vault: string, amount: string | null): Promise<Built> {
  const v = await ctx(vault);
  const raw = amount ? parseDecimal(amount, v.loanDec, "amount") : 0n;
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("repay", [raw]), value: "0", description: amount ? `Repay ${amount} ${v.loanSymbol}` : `Repay as much as the vault holds` }, approvals: [] };
}

export async function buildWithdrawCollateral(vault: string, amount: string): Promise<Built> {
  const v = await ctx(vault);
  const raw = parseDecimal(amount, v.collDec, "amount");
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("withdrawCollateral", [raw]), value: "0", description: `Withdraw ${amount} ${v.collSymbol} to the owner` }, approvals: [] };
}

export async function buildWithdrawToken(vault: string, token: string, amount: string | null): Promise<Built> {
  const v = await ctx(vault);
  if (!ethers.isAddress(token)) throw new ApiError(400, "token is not an address");
  const meta = tokenMeta(token);
  const dec = meta?.decimals ?? (amount ? await decimalsOf(token) : 18);
  const raw = amount ? parseDecimal(amount, dec, "amount") : 0n;
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("withdrawToken", [token, raw]), value: "0", description: `Withdraw ${amount ?? "all"} ${meta?.symbol ?? "tokens"} to the owner` }, approvals: [] };
}

export async function buildSetOperator(vault: string, operator: string): Promise<Built> {
  const v = await ctx(vault);
  if (!ethers.isAddress(operator)) throw new ApiError(400, "operator is not an address");
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setOperator", [operator]), value: "0", description: `Set operator to ${operator}` }, approvals: [] };
}

export async function buildSetPolicy(vault: string, policy: PolicyInput): Promise<Built> {
  const v = await ctx(vault);
  const c = new ethers.Contract(v.address, vaultIface, getProvider());
  const mp = await c.currentMarket();
  validPolicy(policy, BigInt(mp[4]));
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setPolicy", [[policy.maxLtvBps, policy.triggerLtvBps, policy.repayBps, policy.maxSlippageBps]]), value: "0", description: "Update the policy" }, approvals: [] };
}

export async function buildSetPaused(vault: string, paused: boolean): Promise<Built> {
  const v = await ctx(vault);
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setPaused", [paused]), value: "0", description: paused ? "Turn the agent off" : "Turn the agent on" }, approvals: [] };
}

export async function buildSetMarketAllowed(vault: string, marketId: string, allowed: boolean): Promise<Built> {
  const v = await ctx(vault);
  const m = await resolveMarket(marketId);
  if (!m) throw new ApiError(404, "unknown market");
  if (allowed) {
    const c = new ethers.Contract(v.address, vaultIface, getProvider());
    const pol = await c.policy();
    if (BigInt(pol[1]) * 10n ** 14n >= BigInt(m.params.lltv)) throw new ApiError(400, `the vault's trigger (${Number(pol[1]) / 100}%) is not below this market's LLTV (${Number(BigInt(m.params.lltv)) / 1e16}%); it cannot be allow-listed`);
  }
  if (m.params.collateralToken.toLowerCase() !== v.collateralToken.toLowerCase() || m.params.loanToken.toLowerCase() !== v.loanToken.toLowerCase()) throw new ApiError(400, "market is not the vault's pair");
  const p = m.params;
  return {
    tx: { to: v.address, data: vaultIface.encodeFunctionData("setMarketAllowed", [[p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv], allowed]), value: "0", description: `${allowed ? "Allow" : "Disallow"} refinancing into market ${marketId.slice(0, 10)} (LLTV ${(Number(p.lltv) / 1e16).toFixed(0)}%)` },
    approvals: [],
  };
}

export async function buildRefinance(vault: string, marketId: string): Promise<Built> {
  const v = await ctx(vault);
  const m = await resolveMarket(marketId);
  if (!m) throw new ApiError(404, "unknown market");
  if (m.params.collateralToken.toLowerCase() !== v.collateralToken.toLowerCase() || m.params.loanToken.toLowerCase() !== v.loanToken.toLowerCase()) throw new ApiError(400, "market is not the vault's pair");
  const p = m.params;
  return {
    tx: { to: v.address, data: vaultIface.encodeFunctionData("refinance", [[p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv]]), value: "0", description: `Move the position to market ${marketId.slice(0, 10)} (LLTV ${(Number(p.lltv) / 1e16).toFixed(0)}%)` },
    approvals: [],
  };
}

/**
 * openLp: the caller says how much loan token to commit, which tier, and a range
 * width around spot (% either side; 0 = full range). `swapShare` (0..1) of the amount is
 * swapped into collateral first so the position is two-sided; the default puts half
 * on each side for a symmetric range and nothing for a one-sided one.
 */
export async function buildOpenLp(vault: string, args: { amount: string; fee: number; widthPct: number; swapShare?: number; slippageBps?: number; deadlineSeconds?: number }): Promise<Built> {
  const v = await ctx(vault);
  const pools = await poolsForPair(v.collateralToken, v.loanToken, v.collDec, v.loanDec);
  const pool = pools.find((p) => p.fee === args.fee);
  if (!pool) throw new ApiError(400, `no ${v.collSymbol}/${v.loanSymbol} pool at fee tier ${args.fee}`);
  if (pool.price === null) throw new ApiError(400, "pool has no price yet");
  const loanAmount = parseDecimal(args.amount, v.loanDec, "amount");
  if (loanAmount <= 0n) throw new ApiError(400, "amount must be positive");
  const { tickLower, tickUpper } = rangeAround(pool.tick, args.widthPct, args.fee);
  if (tickLower >= tickUpper) throw new ApiError(400, "range collapsed; widen widthPct");
  const swapShare = args.swapShare ?? 0.5;
  if (!(swapShare >= 0 && swapShare <= 1)) throw new ApiError(400, "swapShare must be 0..1");
  const swapAmount = (loanAmount * BigInt(Math.round(swapShare * 10_000))) / 10_000n;
  const slippage = args.slippageBps ?? 100;
  // The vault floors every swap at oracle * (1 - maxSlippageBps). A pool whose fee tier
  // alone eats that band can never fill above the floor, so refuse it here with a
  // reason instead of handing the runner a transaction that reverts every tick.
  if (swapAmount > 0n && args.fee / 100 >= slippage) throw new ApiError(400, `the ${args.fee / 10_000}% tier's fee (${args.fee / 100} bps) is not below the slippage allowance (${slippage} bps); pick a cheaper tier or widen the policy band`);
  // Client floor in collateral raw units: pool spot, less the tier's fee, less slippage.
  // The vault's own oracle floor applies on top; this one only has to be reachable.
  const collOut = (Number(ethers.formatUnits(swapAmount, v.loanDec)) / pool.price) * (1 - args.fee / 1_000_000) * (1 - slippage / 10_000);
  const swapMinOut = swapAmount === 0n ? 0n : ethers.parseUnits(collOut.toFixed(v.collDec), v.collDec);
  const deadline = deadlineFromNow(args.deadlineSeconds);
  const data = vaultIface.encodeFunctionData("openLp", [[args.fee, tickLower, tickUpper, loanAmount, swapAmount, swapMinOut, 0n, 0n, deadline]]);
  return {
    tx: { to: v.address, data, value: "0", description: `Open a ${v.collSymbol}/${v.loanSymbol} ${args.fee / 10_000}% position, ${args.widthPct <= 0 ? "full range" : `±${args.widthPct}% around ${pool.price.toFixed(2)}`}, with ${args.amount} ${v.loanSymbol}` },
    approvals: [],
    deadline,
    notes: [
      `ticks ${tickLower}..${tickUpper}; ${ethers.formatUnits(swapAmount, v.loanDec)} ${v.loanSymbol} swapped to ${v.collSymbol} first (floor ${ethers.formatUnits(swapMinOut, v.collDec)})`,
      "Mint floors are 0: the vault checks the pool price against the market oracle before minting, which is the guard that matters.",
    ],
  };
}

export async function buildHarvest(vault: string, tokenId: string, args: { slippageBps?: number; deadlineSeconds?: number } = {}): Promise<Built> {
  const v = await ctx(vault);
  const deadline = deadlineFromNow(args.deadlineSeconds);
  // The vault applies the oracle floor itself; a client floor of 0 is fine and avoids a second price read.
  const data = vaultIface.encodeFunctionData("harvest", [BigInt(tokenId), 0n, deadline]);
  const fees = await uncollectedFees(BigInt(tokenId), v.address);
  const notes = fees ? [`uncollected: ${ethers.formatUnits(fees.amount0, sortTokens(v.collateralToken, v.loanToken)[0].toLowerCase() === v.collateralToken.toLowerCase() ? v.collDec : v.loanDec)} token0 / ${ethers.formatUnits(fees.amount1, sortTokens(v.collateralToken, v.loanToken)[0].toLowerCase() === v.collateralToken.toLowerCase() ? v.loanDec : v.collDec)} token1`] : [];
  return { tx: { to: v.address, data, value: "0", description: `Harvest fees from position #${tokenId} into the debt` }, approvals: [], deadline, notes };
}

export async function buildCloseLp(vault: string, tokenId: string, args: { swapToLoan: boolean; deadlineSeconds?: number }): Promise<Built> {
  const v = await ctx(vault);
  const deadline = deadlineFromNow(args.deadlineSeconds);
  const data = vaultIface.encodeFunctionData("closeLp", [BigInt(tokenId), 0n, 0n, args.swapToLoan, 0n, deadline]);
  return {
    tx: { to: v.address, data, value: "0", description: args.swapToLoan ? `Close position #${tokenId} into ${v.loanSymbol} and repay` : `Close position #${tokenId}, keep both legs in the vault` },
    approvals: [],
    deadline,
    notes: [args.swapToLoan
      ? "Burn floors are 0: the vault refuses to burn while the pool price is off the market oracle."
      : "Without a swap the owner can close at any time, even while the oracle is paused or the pool is off it; both legs stay in the vault."],
  };
}

/**
 * protect: close the given positions (all open ones by default) and, if that is not
 * enough, sell up to `maxCollateralToSell` collateral. The amount defaults to what
 * repays the policy's share at the oracle price plus the slippage allowance.
 */
export async function buildProtect(vault: string, args: { tokenIds?: string[]; maxCollateralToSell?: string; fee?: number; deadlineSeconds?: number }): Promise<Built> {
  const v = await ctx(vault);
  const c = new ethers.Contract(v.address, vaultIface, getProvider());
  const [ids, debt, pol, px] = await Promise.all([c.openPositions(), c.debtAssets(), c.policy(), c.oraclePrice()]);
  const tokenIds = (args.tokenIds ?? [...ids].map((x: bigint) => x.toString())).map((x) => BigInt(x));
  let sell = 0n;
  if (args.maxCollateralToSell) sell = parseDecimal(args.maxCollateralToSell, v.collDec, "maxCollateralToSell");
  else if (BigInt(px) > 0n) {
    const target = (BigInt(debt) * BigInt(pol[2])) / 10_000n;
    // collateral units = loan units * 1e36 / price, plus slippage headroom
    sell = ((target * 10n ** 36n) / BigInt(px)) * (10_000n + BigInt(pol[3]) + 50n) / 10_000n;
  }
  const deadline = deadlineFromNow(args.deadlineSeconds);
  // The collateral sale, if it comes to that, goes through the deepest pool of the pair:
  // a thin tier would slip past the oracle floor and the whole protection would revert.
  let fee = args.fee ?? 0;
  if (!fee) {
    // ...among the tiers the vault allows its operator, or the sale reverts.
    const [pools, allowed] = await Promise.all([poolsForPair(v.collateralToken, v.loanToken, v.collDec, v.loanDec), allowedFeesOf(v.address)]);
    fee = pools.filter((p) => p.price !== null && (allowed === null || allowed.includes(p.fee))).sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]?.fee ?? allowed?.[0] ?? 3000;
  }
  const data = vaultIface.encodeFunctionData("protect", [tokenIds, sell, fee, deadline]);
  return {
    tx: { to: v.address, data, value: "0", description: `Liquidation protection: repay ${Number(pol[2]) / 100}% of the debt` },
    approvals: [],
    deadline,
    notes: [`positions to close: ${tokenIds.join(", ") || "none"}; collateral to sell if needed: ${ethers.formatUnits(sell, v.collDec)} ${v.collSymbol} through the ${fee / 10_000}% pool`],
  };
}

export async function buildSetFeeAllowed(vault: string, fee: number, allowed: boolean): Promise<Built> {
  const v = await ctx(vault);
  if (!(FEE_TIERS as readonly number[]).includes(fee)) throw new ApiError(400, `fee must be one of ${FEE_TIERS.join(", ")}`);
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setFeeAllowed", [fee, allowed]), value: "0", description: `${allowed ? "Allow" : "Forbid"} the ${fee / 10_000}% pool for the agent` }, approvals: [] };
}

export const MAX_OPEN_COOLDOWN_SECONDS = 7 * 24 * 3600;

export async function buildSetOpenCooldown(vault: string, seconds: number): Promise<Built> {
  const v = await ctx(vault);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_OPEN_COOLDOWN_SECONDS) throw new ApiError(400, `seconds must be 0..${MAX_OPEN_COOLDOWN_SECONDS}`);
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setOpenCooldown", [seconds]), value: "0", description: seconds ? `The agent waits ${(seconds / 3600).toFixed(1)} h between two new positions` : "Remove the agent's wait between new positions" }, approvals: [] };
}

export async function buildProposeOwner(vault: string, newOwner: string): Promise<Built> {
  const v = await ctx(vault);
  if (!ethers.isAddress(newOwner)) throw new ApiError(400, "newOwner is not an address");
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("proposeOwner", [newOwner]), value: "0", description: `Propose ${newOwner} as the new owner` }, approvals: [] };
}

export async function buildAcceptOwnership(vault: string): Promise<Built> {
  const v = await ctx(vault);
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("acceptOwnership"), value: "0", description: "Accept ownership" }, approvals: [] };
}

export function buildApprove(token: string, spender: string, amount: string): Tx {
  return { to: token, data: erc20Iface.encodeFunctionData("approve", [spender, BigInt(amount)]), value: "0", description: "Approve" };
}

/** Markets a vault could be allow-listed into, with live rates, for the settings page. */
export async function refinanceTargets(vault: string) {
  const v = await ctx(vault);
  const pair = marketsForPair(v.collateralToken, v.loanToken);
  const c = new ethers.Contract(v.address, vaultIface, getProvider());
  const [states, pol] = await Promise.all([readMarketStates(pair), c.policy()]);
  const trigger = BigInt(pol[1]) * 10n ** 14n;
  return pair.map((m) => ({
    id: m.id, lltv: Number(m.params.lltv) / 1e18, borrowApy: states.get(m.id)?.borrowApy ?? null, liquidity: states.get(m.id)?.liquidity.toString() ?? "0", listed: m.listed,
    /** false when the vault's trigger sits at or above this market's LLTV: the contract refuses it */
    eligible: trigger < BigInt(m.params.lltv),
  }));
}
