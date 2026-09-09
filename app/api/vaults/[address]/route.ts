import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/http";
import { vaultSummary } from "@/lib/services/vaults";
import { ethers } from "ethers";

export const runtime = "nodejs";

/** GET /api/vaults/0x.. -> everything the vault page shows */
export const GET = handler("vault", async (req) => {
  const address = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!ethers.isAddress(address)) throw new ApiError(400, "vault is not an address");
  return NextResponse.json(await vaultSummary(address));
});
