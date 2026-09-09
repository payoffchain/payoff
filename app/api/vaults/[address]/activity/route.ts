import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, readQuery, ApiError } from "@/lib/http";
import { vaultActivity } from "@/lib/services/activity";
import { ethers } from "ethers";

export const runtime = "nodejs";

const q = z.object({ limit: z.string().regex(/^\d+$/).optional() });

/** GET /api/vaults/0x../activity -> decoded event log, newest first */
export const GET = handler("activity", async (req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const address = parts[parts.length - 2] ?? "";
  if (!ethers.isAddress(address)) throw new ApiError(400, "vault is not an address");
  const p = readQuery(req, q);
  return NextResponse.json(await vaultActivity(address, { limit: p.limit ? Math.min(500, Number(p.limit)) : undefined }));
});
