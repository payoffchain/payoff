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
  /** structured target, so a client never has to parse the reason text */
  args: { tokenId?: string; marketId?: string; fee?: number };
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

  // 1. protect. An unknown LTV means the market oracle could not be read; the vault
  // fails closed on that (no swap, no sale), so proposing a protect would only hand
  // the runner a revert. Say so, and stop: nothing else should trade blind either.
  if (v.position.debt > 0 && ltvBps === null) {
    skipped.push({ rule: "protect", why: "the market oracle cannot be read; the vault refuses to trade without a price. Only repaying from idle balance works until it returns." });
    return finish();
  }
  if (v.position.debt > 0 && ltvBps! >= v.policy.triggerLtvBps) {
    const built = await buildProtect(v.address, {});
    actions.push({ kind: "protect", args: {}, reason: `LTV ${(ltvBps! / 100).toFixed(1)}% is at or above the trigger ${(v.policy.triggerLtvBps / 100).toFixed(0)}%`, built, valueUsd: null });
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
        actions.push({ kind: "refinance", args: { marketId: best.id }, reason: `market ${best.id.slice(0, 10)} borrows at ${(best.apy * 100).toFixed(2)}% vs ${(v.market.borrowApy * 100).toFixed(2)}% here (saves ${Math.round(best.saving * 10_000)} bps, $${(v.position.debt * best.saving).toFixed(2)}/yr)`, built, valueUsd: v.position.debt * best.saving });
      } else skipped.push({ rule: "refinance", why: `no allow-listed market beats ${(v.market.borrowApy * 100).toFixed(2)}% by ${s.minSavingsBps} bps with enough liquidity` });
    }
  } else skipped.push({ rule: "refinance", why: v.position.debt === 0 ? "no debt" : "current rate unknown" });

  // Pools of the pair, read once. The vault refuses any mint, burn or swap while a pool's
  // spot price sits further from the market oracle than the policy allows — which is the
  // normal state of a stock pool outside US market hours, when the Chainlink feed pauses
  // and the pool keeps trading. The plan checks the same thing first, so it never hands
  // the runner a transaction that will revert, and it says why instead.
  const pools = (v.lp.length > 0 || (v.balances.loan >= s.minDeployUsd && !v.paused))
    ? await poolsForPair(v.collateral.address, v.loan.address, v.collateral.decimals, v.loan.decimals)
    : [];
  const oracle = v.position.collateralPrice;
  const offOracleBps = (fee: number): number | null => {
    const pool = pools.find((p) => p.fee === fee);
    if (!pool || pool.price === null || !oracle) return null;
    return Math.abs(pool.price / oracle - 1) * 10_000;
  };
  const priceGate = (fee: number): string | null => {
    const off = offOracleBps(fee);
    if (off === null || off <= v.policy.maxSlippageBps) return null;
    return `pool price is ${Math.round(off)} bps off the oracle (policy allows ${v.policy.maxSlippageBps}); likely outside market hours — the vault would refuse the swap`;
  };

  // 3. exit rules per position, 4. harvest
  for (const p of v.lp) {
    const value = (p.valueUsd ?? 0) + (p.uncollected?.usd ?? 0);
    const loss = p.costBasis > 0 ? (p.costBasis - value) / p.costBasis : 0;
    const gate = priceGate(p.fee);
    if (p.costBasis > 0 && loss * 100 >= s.lossLimitPct) {
      if (gate) { skipped.push({ rule: `close #${p.tokenId}`, why: `${(loss * 100).toFixed(1)}% below cost, but ${gate}` }); continue; }
      const built = await buildCloseLp(v.address, p.tokenId, { swapToLoan: true });
      actions.push({ kind: "close", args: { tokenId: p.tokenId }, reason: `position #${p.tokenId} is ${(loss * 100).toFixed(1)}% below cost (limit ${s.lossLimitPct}%): close to ${v.loan.symbol}`, built, valueUsd: null });
      continue;
    }
    if (s.outOfRangeExit && !p.inRange && p.currentPrice !== null && p.priceUpper !== null && p.priceLower !== null) {
      if (p.currentPrice >= p.priceUpper) {
        // Above the range the position is entirely loan token and earns nothing: closing
        // costs no market exposure, and the idle USDG is redeployed by rule 5.
        if (gate) { skipped.push({ rule: `close #${p.tokenId}`, why: `above range, but ${gate}` }); continue; }
        const built = await buildCloseLp(v.address, p.tokenId, { swapToLoan: true });
        actions.push({ kind: "close", args: { tokenId: p.tokenId }, reason: `position #${p.tokenId} is above its range (${p.currentPrice.toFixed(2)} > ${p.priceUpper.toFixed(2)}) and holds only ${v.loan.symbol}: close and redeploy`, built, valueUsd: null });
        continue;
      }
      // Below the range the position is entirely collateral. Closing would sell it at the
      // low; the loss limit above is the only rule that does that. Hold and wait.
      skipped.push({ rule: `close #${p.tokenId}`, why: `below range (${p.currentPrice.toFixed(2)} < ${p.priceLower.toFixed(2)}): holding the ${v.collateral.symbol} leg rather than selling into weakness` });
    }
    if (p.uncollected && (p.uncollected.usd ?? 0) >= s.harvestFloorUsd) {
      if (gate && p.uncollected.collateral > 0) { skipped.push({ rule: `harvest #${p.tokenId}`, why: `$${p.uncollected.usd!.toFixed(2)} of fees waiting, but ${gate}` }); continue; }
      const built = await buildHarvest(v.address, p.tokenId);
      actions.push({ kind: "harvest", args: { tokenId: p.tokenId }, reason: `position #${p.tokenId} has $${p.uncollected.usd!.toFixed(2)} of fees to collect`, built, valueUsd: p.uncollected.usd });
    } else skipped.push({ rule: `harvest #${p.tokenId}`, why: `fees $${(p.uncollected?.usd ?? 0).toFixed(2)} below floor $${s.harvestFloorUsd}` });
  }

  // 5. deploy idle loan token
  if (v.balances.loan >= s.minDeployUsd && !v.paused) {
    // A tier whose fee is not below the policy's slippage band can never fill above the
    // vault's oracle floor; the tx builder refuses it, so do not rank it either.
    // ...nor a tier the owner has not allowed the operator: the vault refuses that too.
    const allowedFees = v.lpLimits.allowedFees;
    const candidates = pools.filter((p) => p.price !== null && (p.tvlUsd ?? 0) > 0 && p.fee / 100 < v.policy.maxSlippageBps && (allowedFees === null || allowedFees.includes(p.fee)));
    let pick = s.preferredFee ? candidates.find((p) => p.fee === s.preferredFee) ?? null : null;
    let reason = "";
    if (!pick) {
      // The pool where THIS deposit would earn the most: the last hour's fees, scaled by
      // the share of the pool the deposit would hold once it is in. A thin pool with real
      // flow can beat a deep one; a deep pool dilutes a small deposit to nothing. The
      // short window keeps the log scan inside a serverless time budget.
      let bestUsdDay = -1;
      const vols = await Promise.all(candidates.map((p) => poolVolume(p, p.token0.toLowerCase() === v.loan.address.toLowerCase(), v.loan.decimals, 1, p.tvlUsd)));
      candidates.forEach((p, i) => {
        const vol = vols[i];
        if (!vol) return;
        const share = v.balances.loan / ((p.tvlUsd ?? 0) + v.balances.loan);
        const usdDay = vol.feesLoan * (24 / vol.hours) * share;
        if (usdDay > bestUsdDay) { bestUsdDay = usdDay; pick = p; reason = `≈ ${usdDay.toFixed(2)}/day for this deposit at the last hour's pace (${Math.round(share * 100)}% of a ${Math.round(p.tvlUsd ?? 0).toLocaleString("en-US")} TVL pool)`; }
      });
      if (!pick && candidates.length) { pick = candidates.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]; reason = "deepest pool"; }
    } else reason = `preferred tier ${pick.fee / 10_000}%`;
    if (pick && v.lpLimits.operatorOpenReadyAt) {
      // The vault spaces the operator's opens out so a bad key cannot grind the balance
      // away in round trips; the owner can still open by hand in the meantime.
      skipped.push({ rule: "deploy", why: `${v.balances.loan.toFixed(2)} ${v.loan.symbol} idle, but the vault lets auto-repay open its next position only after ${new Date(v.lpLimits.operatorOpenReadyAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC (cooldown ${(v.lpLimits.openCooldown / 3600).toFixed(1)} h)` });
    } else if (pick) {
      const gate = priceGate(pick.fee);
      if (gate) {
        skipped.push({ rule: "deploy", why: `${v.balances.loan.toFixed(2)} ${v.loan.symbol} idle, but ${gate}` });
      } else {
        const built = await buildOpenLp(v.address, { amount: v.balances.loan.toFixed(v.loan.decimals), fee: pick.fee, widthPct: s.rangeWidthPct, slippageBps: v.policy.maxSlippageBps });
        actions.push({ kind: "open", args: { fee: pick.fee }, reason: `${v.balances.loan.toFixed(2)} ${v.loan.symbol} idle in the vault → ${pick.fee / 10_000}% pool (${reason}), ±${s.rangeWidthPct}% range`, built, valueUsd: null });
      }
    } else skipped.push({ rule: "deploy", why: allowedFees !== null && allowedFees.length === 0 ? "no pool is allowed for auto-repay yet; allow one in the vault's settings" : "no usable pool among the ones you allowed" });
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
