import { NextResponse } from "next/server";
import { z } from "zod";
import { addressSchema, handler, readQuery, ApiError } from "@/lib/http";
import { ADDR } from "@/lib/chain";
import { poolsForPair, poolVolume } from "@/lib/uniswap";
import { tokenMeta } from "@/lib/tokenmeta";

export const runtime = "nodejs";

/** GET /api/pools?collateral=0x..[&loan=0x..][&hours=6] -> Uniswap V3 pools for the pair with fee yield from recent swaps */
const q = z.object({ collateral: addressSchema, loan: addressSchema.optional(), hours: z.string().regex(/^\d+$/).optional() });

export const GET = handler("pools", async (req) => {
  const p = readQuery(req, q);
  const loan = p.loan ?? ADDR.usdg();
  const cm = tokenMeta(p.collateral);
  const lm = tokenMeta(loan);
  if (!cm || !lm) throw new ApiError(400, "unknown token; the pair must be in the market snapshot or the stock registry");
  const hours = Math.min(48, Math.max(1, Number(p.hours ?? 6)));
  const pools = await poolsForPair(p.collateral, loan, cm.decimals, lm.decimals);
  const out = [];
  for (const pool of pools) {
    const vol = await poolVolume(pool, pool.token0.toLowerCase() === loan.toLowerCase(), lm.decimals, hours, pool.tvlUsd);
    out.push({ ...pool, volume: vol });
  }
  out.sort((a, b) => (b.volume?.feeApr ?? -1) - (a.volume?.feeApr ?? -1));
  return NextResponse.json({ collateral: { address: cm.address, symbol: cm.symbol, decimals: cm.decimals }, loan: { address: lm.address, symbol: lm.symbol, decimals: lm.decimals }, hours, pools: out, note: "Fee APR is pool-wide: volume × fee tier over the window, annualised, over the pool's token balances. A concentrated position in range earns more per dollar; out of range it earns nothing." });
});
