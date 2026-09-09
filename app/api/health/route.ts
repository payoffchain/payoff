import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { handler } from "@/lib/http";
import { ADDR, CHAIN_ID, DEFAULTS, getProvider } from "@/lib/chain";
import { snapshotInfo } from "@/lib/morpho";

export const runtime = "nodejs";

/** GET /api/health — what is configured, what is reachable. Names env vars, never values. */
export const GET = handler("health", async () => {
  const checks: Record<string, { ok: boolean; detail: string }> = {};
  const factory = ADDR.factoryOrNull();
  checks.PAYOFF_FACTORY_ADDRESS = factory ? { ok: true, detail: factory } : { ok: false, detail: "not set — vaults cannot be created or listed" };
  for (const [name, get] of [["MORPHO_ADDRESS", ADDR.morpho], ["UNISWAP_V3_POSITION_MANAGER", ADDR.positionManager], ["UNISWAP_V3_SWAP_ROUTER", ADDR.swapRouter], ["UNISWAP_V3_FACTORY", ADDR.uniFactory], ["USDG_ADDRESS", ADDR.usdg]] as const) {
    try { checks[name] = { ok: true, detail: get() }; } catch (e) { checks[name] = { ok: false, detail: (e as Error).message }; }
  }
  let rpc: { ok: boolean; detail: string };
  try {
    const provider = getProvider();
    const [block, code] = await Promise.all([provider.getBlockNumber(), factory ? provider.getCode(factory) : Promise.resolve("0x")]);
    rpc = { ok: true, detail: `block ${block}` };
    if (factory) checks.factoryCode = code && code !== "0x" ? { ok: true, detail: `${(code.length - 2) / 2} bytes` } : { ok: false, detail: "no code at PAYOFF_FACTORY_ADDRESS" };
  } catch (e) {
    rpc = { ok: false, detail: (e as Error).message };
  }
  checks.rpc = rpc;
  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, chainId: CHAIN_ID, rpcUrl: process.env.RPC_URL ? "set" : `default (${DEFAULTS.rpcUrl})`, snapshot: snapshotInfo(), checks, version: process.env.npm_package_version ?? null }, { status: ok ? 200 : 503 });
});
