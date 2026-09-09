import { cached } from "../chain";
import { listVaults, vaultRows, type VaultRow } from "./vaults";

/**
 * Every vault the factory made, ranked by what its agent has actually repaid out of
 * trading fees. On-chain numbers only; wallet addresses only.
 */
export type LeaderboardEntry = VaultRow & { rank: number; repaidPct: number | null };

export async function leaderboard(opts: { limit?: number } = {}) {
  const { value, cachedAt, stale } = await cached("leaderboard", 30_000, async () => {
    const { vaults, count } = await listVaults();
    const rows = await vaultRows(vaults);
    rows.sort((a, b) => b.totalRepaidFromFees - a.totalRepaidFromFees || b.totalHarvested - a.totalHarvested);
    const entries: LeaderboardEntry[] = rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      repaidPct: r.debt + r.totalRepaidFromFees > 0 ? r.totalRepaidFromFees / (r.debt + r.totalRepaidFromFees) : null,
    }));
    const totals = {
      vaults: count,
      debtUsd: rows.reduce((a, r) => a + r.debt, 0),
      collateralUsd: rows.reduce((a, r) => a + (r.collateralUsd ?? 0), 0),
      repaidFromFeesUsd: rows.reduce((a, r) => a + r.totalRepaidFromFees, 0),
      harvestedUsd: rows.reduce((a, r) => a + r.totalHarvested, 0),
      refinances: rows.reduce((a, r) => a + r.refinanceCount, 0),
      openPositions: rows.reduce((a, r) => a + r.openPositions, 0),
    };
    return { entries, totals };
  });
  return { ...value, entries: value.entries.slice(0, opts.limit ?? 100), cachedAt: new Date(cachedAt).toISOString(), stale };
}
