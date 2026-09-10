import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, readQuery, ApiError } from "@/lib/http";
import { planFor } from "@/lib/services/plan";
import { ethers } from "ethers";

export const runtime = "nodejs";
// Log scans and multicalls over the public RPC can take longer than the default serverless budget.
export const maxDuration = 60;

const num = z.string().regex(/^\d+(\.\d+)?$/).optional();
const q = z.object({ minSavingsBps: num, harvestFloorUsd: num, minDeployUsd: num, rangeWidthPct: num, preferredFee: num, lossLimitPct: num, outOfRangeExit: z.string().optional() });

/** GET /api/vaults/0x../plan -> what the agent would do right now, with calldata for each action */
export const GET = handler("plan", async (req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const address = parts[parts.length - 2] ?? "";
  if (!ethers.isAddress(address)) throw new ApiError(400, "vault is not an address");
  const p = readQuery(req, q);
  const o: Record<string, number | boolean | null> = {};
  for (const k of ["minSavingsBps", "harvestFloorUsd", "minDeployUsd", "rangeWidthPct", "preferredFee", "lossLimitPct"] as const) if (p[k] !== undefined) o[k] = Number(p[k]);
  if (p.outOfRangeExit !== undefined) o.outOfRangeExit = p.outOfRangeExit !== "0";
  return NextResponse.json(await planFor(address, o as any));
});
