import "dotenv/config";
import { rateBoard } from "../lib/services/rates.ts";
import { getProvider } from "../lib/chain.ts";
import { ethers } from "ethers";
const b = await rateBoard();
console.log("live", b.live, "stale", b.stale, "error", b.error, "cachedAt", b.statesCachedAt);
for (const sym of ["NVDA", "TSLA", "SPY", "WETH", "USDe"]) {
  const g = b.groups.find((g) => g.collateral.symbol === sym);
  if (!g) { console.log(sym, "none"); continue; }
  console.log(sym, "oracle", [...new Set(g.rows.map((r) => r.collateralPrice?.toFixed(2)))].join("/"), "best", g.best && (g.best.borrowApy * 100).toFixed(2) + "% liq $" + Math.round(g.best.liquidityUsd) + " lltv " + g.best.lltv, "live rows", g.rows.filter(r=>r.live).length + "/" + g.rows.length);
}
// direct oracle read for the NVDA 63% market with $13k liquidity
const nv = b.rows.find((r) => r.id.startsWith("0x66306c08"));
if (nv) { const o = new ethers.Contract(nv.oracle, ["function price() view returns (uint256)"], getProvider()); const p = await o.price(); console.log("NVDA oracle raw", p.toString(), "=> ", ethers.formatUnits(p, 36 + 6 - 18)); }
