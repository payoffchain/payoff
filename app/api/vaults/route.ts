import { NextResponse } from "next/server";
import { z } from "zod";
import { addressSchema, handler, readQuery } from "@/lib/http";
import { listVaults, vaultRows } from "@/lib/services/vaults";

export const runtime = "nodejs";
// Log scans and multicalls over the public RPC can take longer than the default serverless budget.
export const maxDuration = 60;

/** GET /api/vaults?owner=0x.. -> the owner's vaults (light rows); without owner, every vault */
const q = z.object({ owner: addressSchema.optional() });

export const GET = handler("vaults", async (req) => {
  const p = readQuery(req, q);
  const { vaults, count } = await listVaults(p.owner);
  const rows = await vaultRows(vaults);
  return NextResponse.json({ count, vaults: rows });
});
