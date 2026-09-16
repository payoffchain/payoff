import { ethers } from "ethers";
import { BLOCKS_PER_DAY, getLogsRecent, getProvider, vaultIface } from "../chain";
import { tokenMeta } from "../tokenmeta";
import { isVault, vaultCreationBlock } from "./vaults";
import { ApiError } from "../http";
import { decimalsOf } from "../tokens";

/**
 * A vault's activity log, straight from its events. Every action the operator or the
 * owner took is here with its transaction hash; nothing is stored off chain.
 */

export type ActivityEntry = {
  block: number;
  logIndex: number;
  time: number | null;
  tx: string;
  type: string;
  title: string;
  detail: string;
  args: Record<string, string>;
};

const SKIP = new Set(["Swapped"]); // folded into the action that caused it

export async function vaultActivity(vault: string, opts: { limit?: number; fromBlock?: number; days?: number } = {}): Promise<{ entries: ActivityEntry[]; fromBlock: number; toBlock: number; partial: boolean }> {
  if (!ethers.isAddress(vault)) throw new ApiError(400, "vault is not an address");
  if (!(await isVault(vault))) throw new ApiError(404, "not a Payoff vault");
  const provider = getProvider();
  const toBlock = await provider.getBlockNumber();
  const created = await vaultCreationBlock(vault);
  // Newest first, inside a window and a time budget. An older vault gets its recent
  // history quickly and `partial: true`, never a timeout.
  const window = Math.round(BLOCKS_PER_DAY * Math.min(90, Math.max(1, opts.days ?? 7)));
  const floor = Math.max(0, created ?? 0, toBlock - window);
  const fromBlock = Math.max(floor, opts.fromBlock ?? 0);
  const { logs, scannedFrom, partial } = await getLogsRecent({ address: vault }, fromBlock, toBlock, { budgetMs: 25_000 });

  const c = new ethers.Contract(vault, vaultIface, provider);
  const [collateralToken, loanToken] = await Promise.all([c.collateralToken(), c.loanToken()]);
  const cm = tokenMeta(collateralToken);
  const lm = tokenMeta(loanToken);
  const [collDec, loanDec] = await Promise.all([cm?.decimals ?? decimalsOf(collateralToken), lm?.decimals ?? decimalsOf(loanToken)]);
  const L = (x: bigint) => `${Number(ethers.formatUnits(x, loanDec)).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${lm?.symbol ?? "loan"}`;
  const C = (x: bigint) => `${Number(ethers.formatUnits(x, collDec)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${cm?.symbol ?? "collateral"}`;
  const [t0] = collateralToken.toLowerCase() < loanToken.toLowerCase() ? [collateralToken] : [loanToken];
  const tok0IsColl = t0.toLowerCase() === collateralToken.toLowerCase();
  const T0 = (x: bigint) => (tok0IsColl ? C(x) : L(x));
  const T1 = (x: bigint) => (tok0IsColl ? L(x) : C(x));

  const entries: ActivityEntry[] = [];
  for (const log of logs) {
    let ev: ethers.LogDescription | null = null;
    try {
      ev = vaultIface.parseLog({ topics: log.topics as string[], data: log.data });
    } catch { /* not ours */ }
    if (!ev || SKIP.has(ev.name)) continue;
    const a = ev.args;
    const base = { block: log.blockNumber, logIndex: log.index, time: null, tx: log.transactionHash, type: ev.name, args: {} as Record<string, string> };
    ev.fragment.inputs.forEach((inp, i) => { base.args[inp.name] = String(a[i]); });
    let title = ev.name, detail = "";
    switch (ev.name) {
      case "Initialized": title = "Vault created"; detail = `owner ${a.owner}, operator ${a.operator}`; break;
      case "CollateralDeposited": title = "Collateral deposited"; detail = C(a.amount); break;
      case "CollateralWithdrawn": title = "Collateral withdrawn"; detail = `${C(a.amount)} to owner`; break;
      case "LoanTokenDeposited": title = "Deposit"; detail = L(a.amount); break;
      case "TokenWithdrawn": title = "Withdrawal"; detail = `${tokenMeta(a.token)?.symbol ?? a.token} to owner`; break;
      case "Borrowed": title = "Borrowed"; detail = `${L(a.amount)} · LTV after ${(Number(a.ltvBpsAfter) / 100).toFixed(1)}%`; break;
      case "Repaid": title = a.source === "fees" ? "Debt repaid from fees" : a.source === "protect" ? "Debt repaid (protection)" : "Debt repaid"; detail = L(a.amount); break;
      case "Refinanced": title = "Refinanced"; detail = `${String(a.fromMarket).slice(0, 10)} → ${String(a.toMarket).slice(0, 10)} · debt ${L(a.debt)} · LTV ${(Number(a.ltvBpsAfter) / 100).toFixed(1)}%`; break;
      case "LpOpened": title = "Liquidity opened"; detail = `#${a.tokenId} · ${Number(a.fee) / 10_000}% pool · ticks ${a.tickLower}..${a.tickUpper} · ${T0(a.amount0)} + ${T1(a.amount1)}`; break;
      case "Harvested": title = "Fees harvested"; detail = `#${a.tokenId} · ${T0(a.fee0)} + ${T1(a.fee1)} → ${L(a.loanTokenOut)} · ${L(a.repaid)} to debt`; break;
      case "LpClosed": title = "Liquidity closed"; detail = `#${a.tokenId} · ${T0(a.amount0)} + ${T1(a.amount1)}${a.swappedToLoan ? ` → ${L(a.loanTokenOut)} · ${L(a.repaid)} to debt${BigInt(a.performanceFee) > 0n ? ` · fee ${L(a.performanceFee)}` : ""}` : " kept in vault"}`; break;
      case "Protected": title = "Liquidation protection"; detail = `LTV ${(Number(a.ltvBpsBefore) / 100).toFixed(1)}% → ${(Number(a.ltvBpsAfter) / 100).toFixed(1)}% · repaid ${L(a.repaid)}${BigInt(a.collateralSold) > 0n ? ` · sold ${C(a.collateralSold)}` : ""}`; break;
      case "OperatorSet": title = "Operator changed"; detail = String(a.operator); break;
      case "PolicySet": title = "Policy updated"; detail = `max LTV ${Number(a.maxLtvBps) / 100}% · trigger ${Number(a.triggerLtvBps) / 100}% · repay ${Number(a.repayBps) / 100}% · slippage ${Number(a.maxSlippageBps) / 100}%`; break;
      case "MarketAllowed": title = a.allowed ? "Market allowed" : "Market removed"; detail = String(a.id).slice(0, 10); break;
      case "Paused": title = a.paused ? "Auto-repay turned off" : "Auto-repay turned on"; break;
      case "OwnershipProposed": title = "Ownership proposed"; detail = String(a.pendingOwner); break;
      case "OwnershipTransferred": title = "Ownership transferred"; detail = `${a.from} → ${a.to}`; break;
    }
    entries.push({ ...base, title, detail });
  }
  // Newest first; within a block, the later log first.
  entries.sort((x, y) => y.block - x.block || y.logIndex - x.logIndex);
  const limited = entries.slice(0, opts.limit ?? 100);
  // timestamps for the blocks shown (deduplicated)
  const blocks = [...new Set(limited.map((e) => e.block))];
  const times = new Map<number, number>();
  await Promise.all(blocks.map(async (b) => { try { const blk = await provider.getBlock(b); if (blk) times.set(b, blk.timestamp); } catch { /* shown without time */ } }));
  for (const e of limited) e.time = times.get(e.block) ?? null;
  return { entries: limited, fromBlock: scannedFrom, toBlock, partial };
}
