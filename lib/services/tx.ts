import { ethers } from "ethers";
import { ADDR, factoryIface, getProvider, vaultIface } from "../chain";
import { marketById, marketsForPair, readMarketStates } from "../morpho";
import { erc20Iface, poolsForPair, rangeAround, sortTokens, uncollectedFees } from "../uniswap";
import { tokenMeta } from "../tokenmeta";
import { parseDecimal } from "../tokens";
import { ApiError } from "../http";

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

function validPolicy(p: PolicyInput) {
  if (p.maxLtvBps > 9500) throw new ApiError(400, "maxLtvBps above 9500");
  if (p.triggerLtvBps < p.maxLtvBps || p.triggerLtvBps > 10_000) throw new ApiError(400, "triggerLtvBps must be between maxLtvBps and 10000");
  if (p.repayBps <= 0 || p.repayBps > 10_000) throw new ApiError(400, "repayBps must be 1..10000");
  if (p.maxSlippageBps > 2000) throw new ApiError(400, "maxSlippageBps above 2000");
}

/** createVault(operator, initialMarket, policy) on the factory. */
export function buildCreateVault(args: { marketId: string; operator: string; policy?: PolicyInput }): Built {
  const m = marketById(args.marketId);
  if (!m) throw new ApiError(404, "unknown market");
  if (!ethers.isAddress(args.operator)) throw new ApiError(400, "operator is not an address");
  const policy = args.policy ?? DEFAULT_POLICY;
  validPolicy(policy);
  const p = m.params;
  const data = factoryIface.encodeFunctionData("createVault", [
    args.operator,
    [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv],
    [policy.maxLtvBps, policy.triggerLtvBps, policy.repayBps, policy.maxSlippageBps],
  ]);
  return {
    tx: { to: ADDR.factory(), data, value: "0", description: `Create a ${m.collateral.symbol}/${m.loan.symbol} vault (LLTV ${(Number(p.lltv) / 1e16).toFixed(0)}%)` },
    approvals: [],
    notes: ["The vault address is emitted as VaultCreated(vault, owner, operator, ...); read it from the receipt."],
  };
}

type VaultCtx = { address: string; collateralToken: string; loanToken: string; collDec: number; loanDec: number; collSymbol: string; loanSymbol: string };

async function ctx(vault: string): Promise<VaultCtx> {
  if (!ethers.isAddress(vault)) throw new ApiError(400, "vault is not an address");
  const c = new ethers.Contract(vault, vaultIface, getProvider());
  const [collateralToken, loanToken] = await Promise.all([c.collateralToken(), c.loanToken()]);
  const cm = tokenMeta(collateralToken);
  const lm = tokenMeta(loanToken);
  return { address: ethers.getAddress(vault), collateralToken, loanToken, collDec: cm?.decimals ?? 18, loanDec: lm?.decimals ?? 6, collSymbol: cm?.symbol ?? "COLL", loanSymbol: lm?.symbol ?? "LOAN" };
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
  const raw = amount ? parseDecimal(amount, meta?.decimals ?? 18, "amount") : 0n;
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("withdrawToken", [token, raw]), value: "0", description: `Withdraw ${amount ?? "all"} ${meta?.symbol ?? "tokens"} to the owner` }, approvals: [] };
}

export async function buildSetOperator(vault: string, operator: string): Promise<Built> {
  const v = await ctx(vault);
  if (!ethers.isAddress(operator)) throw new ApiError(400, "operator is not an address");
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setOperator", [operator]), value: "0", description: `Set operator to ${operator}` }, approvals: [] };
}

export async function buildSetPolicy(vault: string, policy: PolicyInput): Promise<Built> {
  const v = await ctx(vault);
  validPolicy(policy);
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setPolicy", [[policy.maxLtvBps, policy.triggerLtvBps, policy.repayBps, policy.maxSlippageBps]]), value: "0", description: "Update the policy" }, approvals: [] };
}

export async function buildSetPaused(vault: string, paused: boolean): Promise<Built> {
  const v = await ctx(vault);
  return { tx: { to: v.address, data: vaultIface.encodeFunctionData("setPaused", [paused]), value: "0", description: paused ? "Pause the operator" : "Resume the operator" }, approvals: [] };
}

export async function buildSetMarketAllowed(vault: string, marketId: string, allowed: boolean): Promise<Built> {
  const v = await ctx(vault);
  const m = marketById(marketId);
  if (!m) throw new ApiError(404, "unknown market");
  if (m.params.collateralToken.toLowerCase() !== v.collateralToken.toLowerCase() || m.params.loanToken.toLowerCase() !== v.loanToken.toLowerCase()) throw new ApiError(400, "market is not the vault's pair");
  const p = m.params;
  return {
    tx: { to: v.address, data: vaultIface.encodeFunctionData("setMarketAllowed", [[p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv], allowed]), value: "0", description: `${allowed ? "Allow" : "Disallow"} refinancing into market ${marketId.slice(0, 10)} (LLTV ${(Number(p.lltv) / 1e16).toFixed(0)}%)` },
    approvals: [],
  };
}

export async function buildRefinance(vault: string, marketId: string): Promise<Built> {
  const v = await ctx(vault);
  const m = marketById(marketId);
  if (!m) throw new ApiError(404, "unknown market");
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
  const { tickLower, tickUpper } = rangeAround(pool.tick, args.widthPct, args.fee);
  const swapShare = args.swapShare ?? (args.widthPct <= 0 ? 0.5 : 0.5);
  const swapAmount = (loanAmount * BigInt(Math.round(swapShare * 10_000))) / 10_000n;
  const slippage = args.slippageBps ?? 100;
  // swapMinOut in collateral raw units from the pool price, less slippage
  const collOut = (Number(ethers.formatUnits(swapAmount, v.loanDec)) / pool.price) * (1 - slippage / 10_000);
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
    notes: ["Burn floors are 0: the vault refuses to burn while the pool price is off the market oracle."],
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
  const data = vaultIface.encodeFunctionData("protect", [tokenIds, sell, args.fee ?? 3000, deadline]);
  return {
    tx: { to: v.address, data, value: "0", description: `Liquidation protection: repay ${Number(pol[2]) / 100}% of the debt` },
    approvals: [],
    deadline,
    notes: [`positions to close: ${tokenIds.join(", ") || "none"}; collateral to sell if needed: ${ethers.formatUnits(sell, v.collDec)} ${v.collSymbol}`],
  };
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
  const states = await readMarketStates(pair);
  return pair.map((m) => ({ id: m.id, lltv: Number(m.params.lltv) / 1e18, borrowApy: states.get(m.id)?.borrowApy ?? null, liquidity: states.get(m.id)?.liquidity.toString() ?? "0", listed: m.listed }));
}
