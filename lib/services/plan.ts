import { ethers } from "ethers";
import { marketById, marketsForPair, readMarketStates } from "../morpho";
import { poolsForPair, poolVolume } from "../uniswap";
import { vaultSummary, type VaultSummary } from "./vaults";
import { buildCloseLp, buildHarvest, buildOpenLp, buildProtect, buildRefinance, type Built } from "./tx";

/**
 * The agent's decision, as a pure function of the vault's state and the market. The
 * runner asks the API for this every tick and signs what it says; the UI shows the same
 * plan under "what the agent would do now", so there is one brain, and it is readable.
 *
 * Rules, in priority order:
 *   1. PROTECT — LTV at or above the policy trigger: close positions / sell collateral.
 *   2. REFINANCE — an allow-listed market of the same pair is cheaper by at least
 *      `minSavingsBps`, has the liquidity, and keeps the position inside policy LTV.
 *   3. EXIT — a position is out of range and the loss limit or the exit rule says cash.
 *   4. HARVEST — uncollected fees are worth at least `harvestFloorUsd`.
 *   5. DEPLOY — idle loan token in the vault (borrowed but not deployed) of at least
 *      `minDeployUsd`: open a position in the busiest pool of the pair.
 * Every rule that fires explains itself; every rule that does not says why.
 */

export type PlanAction = {
  kind: "protect" | "refinance" | "harvest" | "close" | "open";
  reason: string;
  built: Built;
  /** estimated $ effect per year (savings) or now (fees) */
  valueUsd: number | null;
};

export type Plan = {
  vault: string;
  at: string;
  ltv: number | null;
  actions: PlanAction[];
  skipped: Array<{ rule: string; why: string }>;
  settings: PlanSettings;
};

export type PlanSettings = {
  minSavingsBps: number;
  harvestFloorUsd: number;
  minDeployUsd: number;
  rangeWidthPct: number;
  preferredFee: number | null;
  lossLimitPct: number;
  outOfRangeExit: boolean;
};

export const DEFAULT_SETTINGS: PlanSettings = {
  minSavingsBps: Number(process.env.AGENT_MIN_SAVINGS_BPS ?? 30),
  harvestFloorUsd: Number(process.env.AGENT_HARVEST_FLOOR_USD ?? 1),
  minDeployUsd: Number(process.env.AGENT_MIN_DEPLOY_USD ?? 25),
  rangeWidthPct: Number(process.env.AGENT_RANGE_WIDTH_PCT ?? 5),
  preferredFee: process.env.AGENT_PREFERRED_FEE ? Number(process.env.AGENT_PREFERRED_FEE) : null,
  lossLimitPct: Number(process.env.AGENT_LOSS_LIMIT_PCT ?? 15),
  outOfRangeExit: (process.env.AGENT_OUT_OF_RANGE_EXIT ?? "true") !== "false",
};

export async function planFor(vaultAddress: string, overrides: Partial<PlanSettings> = {}, pre?: VaultSummary): Promise<Plan> {
  const s = { ...DEFAULT_SETTINGS, ...overrides };
  const v = pre ?? (await vaultSummary(vaultAddress));
  const actions: PlanAction[] = [];
  const skipped: Plan["skipped"] = [];
  const ltvBps = v.position.ltvBps;

  // 1. protect
  if (v.position.debt > 0 && (ltvBps === null || ltvBps >= v.policy.triggerLtvBps)) {
    const built = await buildProtect(v.address, {});
    actions.push({ kind: "protect", reason: `LTV ${ltvBps === null ? "unknown" : (ltvBps / 100).toFixed(1) + "%"} is at or above the trigger ${(v.policy.triggerLtvBps / 100).toFixed(0)}%`, built, valueUsd: null });
    return finish();
  }
  skipped.push({ rule: "protect", why: v.position.debt === 0 ? "no debt" : `LTV ${(ltvBps! / 100).toFixed(1)}% below trigger ${(v.policy.triggerLtvBps / 100).toFixed(0)}%` });

  // 2. refinance
  if (v.position.debt > 0 && v.market.borrowApy !== null) {
    const pair = marketsForPair(v.collateral.address, v.loan.address).filter((m) => v.allowedMarkets.includes(m.id) && m.id !== v.market.id);
    if (pair.length === 0) skipped.push({ rule: "refinance", why: "no other market allow-listed" });
    else {
      const states = await readMarketStates(pair);
      let best: { id: string; apy: number; saving: number } | null = null;
      const debtRaw = BigInt(v.position.debtRaw);
      for (const m of pair) {
        const st = states.get(m.id);
        if (!st || st.borrowApy === null) continue;
        const saving = v.market.borrowApy - st.borrowApy;
        if (saving * 10_000 < s.minSavingsBps) continue;
        if (st.liquidity < debtRaw) continue;
        // LTV in the target: same collateral, target oracle
        if (st.oraclePrice) {
          const collValue = (BigInt(v.position.collateralRaw) * st.oraclePrice) / 10n ** 36n;
          const ltvThere = collValue === 0n ? Infinity : Number((debtRaw * 10_000n) / collValue);
          if (ltvThere > v.policy.maxLtvBps) continue;
        }
        if (!best || st.borrowApy < best.apy) best = { id: m.id, apy: st.borrowApy, saving };
      }
      if (best) {
        const built = await buildRefinance(v.address, best.id);
        actions.push({ kind: "refinance", reason: `market ${best.id.slice(0, 10)} borrows at ${(best.apy * 100).toFixed(2)}% vs ${(v.market.borrowApy * 100).toFixed(2)}% here (saves ${Math.round(best.saving * 10_000)} bps, $${(v.position.debt * best.saving).toFixed(2)}/yr)`, built, valueUsd: v.position.debt * best.saving });
      } else skipped.push({ rule: "refinance", why: `no allow-listed market beats ${(v.market.borrowApy * 100).toFixed(2)}% by ${s.minSavingsBps} bps with enough liquidity` });
    }
  } else skipped.push({ rule: "refinance", why: v.position.debt === 0 ? "no debt" : "current rate unknown" });

  // 3. exit rules per position, 4. harvest
  for (const p of v.lp) {
    const value = (p.valueUsd ?? 0) + (p.uncollected?.usd ?? 0);
    const loss = p.costBasis > 0 ? (p.costBasis - value) / p.costBasis : 0;
    if (p.costBasis > 0 && loss * 100 >= s.lossLimitPct) {
      const built = await buildCloseLp(v.address, p.tokenId, { swapToLoan: true });
      actions.push({ kind: "close", reason: `position #${p.tokenId} is ${(loss * 100).toFixed(1)}% below cost (limit ${s.lossLimitPct}%): close to ${v.loan.symbol}`, built, valueUsd: null });
      continue;
    }
    if (s.outOfRangeExit && !p.inRange && p.currentPrice !== null && p.priceUpper !== null && p.priceLower !== null) {
      // Out of range on the loan side (price fell below the range) means the position is all
      // collateral and earns nothing; closing into the loan token realises it and repays.
      const built = await buildCloseLp(v.address, p.tokenId, { swapToLoan: true });
      actions.push({ kind: "close", reason: `position #${p.tokenId} is out of range (${p.currentPrice.toFixed(2)} outside ${p.priceLower.toFixed(2)}..${p.priceUpper.toFixed(2)}): close and redeploy`, built, valueUsd: null });
      continue;
    }
    if (p.uncollected && (p.uncollected.usd ?? 0) >= s.harvestFloorUsd) {
      const built = await buildHarvest(v.address, p.tokenId);
      actions.push({ kind: "harvest", reason: `position #${p.tokenId} has $${p.uncollected.usd!.toFixed(2)} of fees to collect`, built, valueUsd: p.uncollected.usd });
    } else skipped.push({ rule: `harvest #${p.tokenId}`, why: `fees $${(p.uncollected?.usd ?? 0).toFixed(2)} below floor $${s.harvestFloorUsd}` });
  }

  // 5. deploy idle loan token
  if (v.balances.loan >= s.minDeployUsd && !v.paused) {
    const pools = await poolsForPair(v.collateral.address, v.loan.address, v.collateral.decimals, v.loan.decimals);
    const candidates = pools.filter((p) => p.price !== null && (p.tvlUsd ?? 0) > 0);
    let pick = s.preferredFee ? candidates.find((p) => p.fee === s.preferredFee) ?? null : null;
    let reason = "";
    if (!pick) {
      // busiest pool by fee yield over the last 6h; fall back to deepest
      let bestApr = -1;
      for (const p of candidates) {
        const vol = await poolVolume(p, p.token0.toLowerCase() === v.loan.address.toLowerCase(), v.loan.decimals, 6, p.tvlUsd);
        const apr = vol?.feeApr ?? -1;
        if (apr > bestApr) { bestApr = apr; pick = p; reason = vol ? `fee yield ≈ ${(apr * 100).toFixed(0)}% APR on $${Math.round(p.tvlUsd ?? 0).toLocaleString("en-US")} TVL over 6h` : "deepest pool"; }
      }
      if (!pick && candidates.length) { pick = candidates.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]; reason = "deepest pool"; }
    } else reason = `preferred tier ${pick.fee / 10_000}%`;
    if (pick) {
      const oracle = v.position.collateralPrice;
      const off = oracle && pick.price ? Math.abs(pick.price / oracle - 1) * 10_000 : 0;
      if (oracle && off > v.policy.maxSlippageBps) {
        skipped.push({ rule: "deploy", why: `pool price ${pick.price!.toFixed(2)} is ${Math.round(off)} bps off the oracle ${oracle.toFixed(2)}; the vault would refuse to mint` });
      } else {
        const built = await buildOpenLp(v.address, { amount: v.balances.loan.toFixed(v.loan.decimals), fee: pick.fee, widthPct: s.rangeWidthPct, slippageBps: v.policy.maxSlippageBps });
        actions.push({ kind: "open", reason: `${v.balances.loan.toFixed(2)} ${v.loan.symbol} idle in the vault → ${pick.fee / 10_000}% pool (${reason}), ±${s.rangeWidthPct}% range`, built, valueUsd: null });
      }
    } else skipped.push({ rule: "deploy", why: "no pool for the pair" });
  } else skipped.push({ rule: "deploy", why: v.paused ? "vault paused" : `idle ${v.loan.symbol} ${v.balances.loan.toFixed(2)} below $${s.minDeployUsd}` });

  return finish();

  function finish(): Plan {
    return { vault: v.address, at: new Date().toISOString(), ltv: v.position.ltv, actions, skipped, settings: s };
  }
}

/** Human summary for logs and the UI. */
export function describePlan(p: Plan): string {
  if (p.actions.length === 0) return "nothing to do";
  return p.actions.map((a) => `${a.kind}: ${a.reason}`).join("; ");
}

export { marketById, ethers };
