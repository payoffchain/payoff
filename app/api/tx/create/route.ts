import { NextResponse } from "next/server";
import { z } from "zod";
import { addressSchema, handler, readJson } from "@/lib/http";
import { buildCreateVault, DEFAULT_POLICY } from "@/lib/services/tx";
import { ADDR } from "@/lib/chain";

export const runtime = "nodejs";

/** POST /api/tx/create { marketId, operator, policy? } -> factory.createVault calldata */
const body = z.object({
  marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  operator: addressSchema,
  policy: z.object({ maxLtvBps: z.number().int().min(0).max(10_000), triggerLtvBps: z.number().int().min(0).max(10_000), repayBps: z.number().int().min(0).max(10_000), maxSlippageBps: z.number().int().min(0).max(10_000) }).optional(),
});

export const POST = handler("create", async (req) => {
  const b = await readJson(req, body);
  return NextResponse.json({ ...(await buildCreateVault(b)), factory: ADDR.factory(), defaultPolicy: DEFAULT_POLICY });
});

export const GET = handler("create", async () => NextResponse.json({ factory: ADDR.factoryOrNull(), defaultPolicy: DEFAULT_POLICY }));
