import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, readQuery } from "@/lib/http";
import { opportunitiesFor } from "@/lib/services/rates";

export const runtime = "nodejs";

/** GET /api/markets/opportunities?from=<marketId>&debt=1000&collateral=20 */
const q = z.object({
  from: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  debt: z.string().regex(/^\d+(\.\d+)?$/),
  collateral: z.string().regex(/^\d+(\.\d+)?$/),
  minSavingsBps: z.string().regex(/^\d+$/).optional(),
});

export const GET = handler("opportunities", async (req) => {
  const p = readQuery(req, q);
  return NextResponse.json(await opportunitiesFor({ fromId: p.from, debtUsd: Number(p.debt), collateralUnits: Number(p.collateral), minSavingsBps: p.minSavingsBps ? Number(p.minSavingsBps) : undefined }));
});
