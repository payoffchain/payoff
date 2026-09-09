import "dotenv/config";
// Read real Robinhood Chain state through the same helpers the site uses. No key needed.
//   node --import tsx scripts/smoke.mjs   (or: npx tsx scripts/smoke.mjs)
import { rateBoard, opportunitiesFor } from "../lib/services/rates.ts";
import { poolsForPair, poolVolume } from "../lib/uniswap.ts";
import { DEFAULTS } from "../lib/chain.ts";

const board = await rateBoard();
console.log(`snapshot ${board.snapshot.fetchedAt}, live=${board.live}, groups=${board.groups.length}, stale=${board.stale}, error=${board.error}`);
for (const g of board.groups.slice(0, 8)) {
  console.log(`\n${g.collateral.symbol} (${g.collateral.isStock ? "stock" : "crypto"})  best=${g.best ? (g.best.borrowApy * 100).toFixed(2) + "% @ lltv " + g.best.lltv : "-"}`);
  for (const r of g.rows) {
    console.log(`  ${r.id.slice(0, 10)} lltv=${(r.lltv * 100).toFixed(0)}% borrow=${r.borrowApy === null ? "?" : (r.borrowApy * 100).toFixed(2) + "%"} util=${(r.utilization * 100).toFixed(0)}% liq=$${Math.round(r.liquidityUsd)} price=${r.collateralPrice?.toFixed(2)} live=${r.live}`);
  }
}
const nvda = board.groups.find((g) => g.collateral.symbol === "NVDA");
if (nvda) {
  const pools = await poolsForPair(nvda.collateral.address, DEFAULTS.usdg, 18, 6);
  console.log("\nNVDA/USDG pools:");
  for (const p of pools) {
    const vol = await poolVolume(p, p.token0.toLowerCase() === DEFAULTS.usdg.toLowerCase(), 6, 6, p.tvlUsd);
    console.log(`  fee=${p.fee} ${p.address} price=${p.price?.toFixed(2)} tvl=$${p.tvlUsd?.toFixed(0)} tick=${p.tick} ` + (vol ? `vol6h=$${vol.volumeLoan.toFixed(0)} swaps=${vol.swaps} feeApr=${vol.feeApr === null ? "?" : (vol.feeApr * 100).toFixed(1) + "%"}` : "volume: unavailable"));
  }
  const busiest = nvda.rows.sort((a, b) => b.totalBorrowUsd - a.totalBorrowUsd)[0];
  const opp = await opportunitiesFor({ fromId: busiest.id, debtUsd: 1000, collateralUnits: 20 });
  console.log(`\nopportunities from ${busiest.id.slice(0, 10)} (${(busiest.borrowApy * 100).toFixed(2)}%):`);
  for (const o of opp.opportunities) console.log(`  -> ${o.to.id.slice(0, 10)} lltv=${o.to.lltv} borrow=${(o.to.borrowApy * 100).toFixed(2)}% saves ${o.savingsBps}bps ($${o.savingsPerYearUsd.toFixed(2)}/yr) liq=${o.hasLiquidity} healthy=${o.healthy}`);
}
