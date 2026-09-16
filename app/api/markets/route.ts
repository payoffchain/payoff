import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, readQuery } from "@/lib/http";
import { rateBoard } from "@/lib/services/rates";

export const runtime = "nodejs";
// Log scans and multicalls over the public RPC can take longer than the default serverless budget.
export const maxDuration = 60;

/**
 * GET /api/markets                -> every USDC market on Morpho, grouped by collateral, live rates
 * GET /api/markets?stocks=1       -> only tokenized-stock collateral
 * GET /api/markets?minLiquidity=  -> what counts as a usable market for "best"
 */
const q = z.object({
  stocks: z.string().optional(),
  minLiquidity: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  live: z.string().optional(),
});

export const GET = handler("markets", async (req) => {
  const p = readQuery(req, q);
  const board = await rateBoard({ live: p.live !== "0", minLiquidityUsd: p.minLiquidity ? Number(p.minLiquidity) : undefined });
  const groups = p.stocks === "1" ? board.groups.filter((g) => g.collateral.isStock) : board.groups;
  return NextResponse.json({ ...board, groups, rows: undefined });
});
