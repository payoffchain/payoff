import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/http";
import { refinanceTargets } from "@/lib/services/tx";
import { ethers } from "ethers";

export const runtime = "nodejs";

/** GET /api/vaults/0x../targets -> markets of the vault's pair with live rates (for the allow-list settings) */
export const GET = handler("targets", async (req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const address = parts[parts.length - 2] ?? "";
  if (!ethers.isAddress(address)) throw new ApiError(400, "vault is not an address");
  return NextResponse.json({ targets: await refinanceTargets(address) });
});
