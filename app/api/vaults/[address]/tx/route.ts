import { NextResponse } from "next/server";
import { z } from "zod";
import { addressSchema, decimalStringSchema, handler, readJson, ApiError } from "@/lib/http";
import * as tx from "@/lib/services/tx";
import { ethers } from "ethers";

export const runtime = "nodejs";

/**
 * POST /api/vaults/0x../tx -> unsigned calldata for one vault action.
 * The server holds no key; the owner's wallet or the operator key signs what comes back.
 */
const policySchema = z.object({ maxLtvBps: z.number().int().min(0).max(10_000), triggerLtvBps: z.number().int().min(0).max(10_000), repayBps: z.number().int().min(1).max(10_000), maxSlippageBps: z.number().int().min(0).max(2000) });
const marketId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const tokenId = z.string().regex(/^\d+$/);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("depositCollateral"), amount: decimalStringSchema }),
  z.object({ action: z.literal("depositLoanToken"), amount: decimalStringSchema }),
  z.object({ action: z.literal("borrow"), amount: decimalStringSchema }),
  z.object({ action: z.literal("repay"), amount: decimalStringSchema.optional() }),
  z.object({ action: z.literal("withdrawCollateral"), amount: decimalStringSchema }),
  z.object({ action: z.literal("withdrawToken"), token: addressSchema, amount: decimalStringSchema.optional() }),
  z.object({ action: z.literal("setOperator"), operator: addressSchema }),
  z.object({ action: z.literal("setPolicy"), policy: policySchema }),
  z.object({ action: z.literal("setPaused"), paused: z.boolean() }),
  z.object({ action: z.literal("setMarketAllowed"), marketId, allowed: z.boolean() }),
  z.object({ action: z.literal("refinance"), marketId }),
  z.object({ action: z.literal("openLp"), amount: decimalStringSchema, fee: z.number().int(), widthPct: z.number().min(0).max(500), swapShare: z.number().min(0).max(1).optional(), slippageBps: z.number().int().min(0).max(2000).optional() }),
  z.object({ action: z.literal("harvest"), tokenId }),
  z.object({ action: z.literal("closeLp"), tokenId, swapToLoan: z.boolean() }),
  z.object({ action: z.literal("protect"), tokenIds: z.array(tokenId).optional(), maxCollateralToSell: decimalStringSchema.optional(), fee: z.number().int().optional() }),
  z.object({ action: z.literal("proposeOwner"), newOwner: addressSchema }),
  z.object({ action: z.literal("acceptOwnership") }),
]);

export const POST = handler("vault-tx", async (req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const vault = parts[parts.length - 2] ?? "";
  if (!ethers.isAddress(vault)) throw new ApiError(400, "vault is not an address");
  const b = await readJson(req, body);
  let built: tx.Built;
  switch (b.action) {
    case "depositCollateral": built = await tx.buildDepositCollateral(vault, b.amount); break;
    case "depositLoanToken": built = await tx.buildDepositLoanToken(vault, b.amount); break;
    case "borrow": built = await tx.buildBorrow(vault, b.amount); break;
    case "repay": built = await tx.buildRepay(vault, b.amount ?? null); break;
    case "withdrawCollateral": built = await tx.buildWithdrawCollateral(vault, b.amount); break;
    case "withdrawToken": built = await tx.buildWithdrawToken(vault, b.token, b.amount ?? null); break;
    case "setOperator": built = await tx.buildSetOperator(vault, b.operator); break;
    case "setPolicy": built = await tx.buildSetPolicy(vault, b.policy); break;
    case "setPaused": built = await tx.buildSetPaused(vault, b.paused); break;
    case "setMarketAllowed": built = await tx.buildSetMarketAllowed(vault, b.marketId, b.allowed); break;
    case "refinance": built = await tx.buildRefinance(vault, b.marketId); break;
    case "openLp": built = await tx.buildOpenLp(vault, { amount: b.amount, fee: b.fee, widthPct: b.widthPct, swapShare: b.swapShare, slippageBps: b.slippageBps }); break;
    case "harvest": built = await tx.buildHarvest(vault, b.tokenId); break;
    case "closeLp": built = await tx.buildCloseLp(vault, b.tokenId, { swapToLoan: b.swapToLoan }); break;
    case "protect": built = await tx.buildProtect(vault, { tokenIds: b.tokenIds, maxCollateralToSell: b.maxCollateralToSell, fee: b.fee }); break;
    case "proposeOwner": built = await tx.buildProposeOwner(vault, b.newOwner); break;
    case "acceptOwnership": built = await tx.buildAcceptOwnership(vault); break;
  }
  return NextResponse.json({ ...built, approveTxs: built.approvals.map((a) => tx.buildApprove(a.token, a.spender, a.amount)) });
});
