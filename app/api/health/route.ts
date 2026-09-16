import { NextResponse } from "next/server";
import { handler } from "@/lib/http";
import { ADDR, CHAIN_ID, DEFAULTS, getProvider, rpcChainId } from "@/lib/chain";
import { snapshotInfo } from "@/lib/morpho";

export const runtime = "nodejs";

/**
 * GET /api/health: what is configured, what is reachable, and whether the pieces agree
 * with each other. Names env vars, never values; RPC failures are reported as a fixed
 * string because ethers folds the request URL (and any key in it) into its messages.
 */
export const GET = handler("health", async () => {
  const checks: Record<string, { ok: boolean; detail: string }> = {};
  const factory = ADDR.factoryOrNull();
  checks.PAYOFF_FACTORY_ADDRESS = factory ? { ok: true, detail: factory } : { ok: false, detail: "not set: vaults cannot be created or listed" };

  const core: Array<[string, () => string]> = [
    ["MORPHO_ADDRESS", ADDR.morpho], ["UNISWAP_V3_POSITION_MANAGER", ADDR.positionManager], ["UNISWAP_V3_SWAP_ROUTER", ADDR.swapRouter],
    ["UNISWAP_V3_FACTORY", ADDR.uniFactory], ["MULTICALL3_ADDRESS", ADDR.multicall3], ["USDC_ADDRESS", ADDR.usdc],
  ];
  const addrs: Array<[string, string]> = [];
  for (const [name, get] of core) {
    try { const a = get(); checks[name] = { ok: true, detail: a }; addrs.push([name, a]); } catch (e) { checks[name] = { ok: false, detail: (e as Error).message }; }
  }
  if (factory) addrs.push(["PAYOFF_FACTORY_ADDRESS", factory]);

  const snap = snapshotInfo();
  checks.snapshot = snap.chainId === CHAIN_ID && (!snap.morpho || snap.morpho.toLowerCase() === (checks.MORPHO_ADDRESS.ok ? checks.MORPHO_ADDRESS.detail.toLowerCase() : ""))
    ? { ok: true, detail: `${snap.count} markets as of ${snap.fetchedAt}` }
    : { ok: false, detail: "lib/morpho-markets.json was synced for another chain or Morpho address; run npm run sync-markets" };

  let block: number | null = null;
  try {
    const provider = getProvider();
    const [b, cid] = await Promise.all([provider.getBlockNumber(), rpcChainId()]);
    block = b;
    checks.rpc = { ok: true, detail: `block ${b}` };
    checks.chainId = cid === CHAIN_ID ? { ok: true, detail: String(cid) } : { ok: false, detail: `RPC serves chain ${cid}, CHAIN_ID is ${CHAIN_ID}` };
    // Every contract the site talks to must have code where it is configured to be.
    const codes = await Promise.all(addrs.map(([, a]) => provider.getCode(a).catch(() => "")));
    addrs.forEach(([name, a], i) => {
      const c = codes[i];
      checks[`code:${name}`] = c && c !== "0x" ? { ok: true, detail: `${(c.length - 2) / 2} bytes at ${a}` } : { ok: false, detail: `no code at ${a}` };
    });
  } catch {
    checks.rpc = { ok: false, detail: "RPC unreachable or timed out" };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { ok, chainId: CHAIN_ID, block, rpcUrl: process.env.RPC_URL ? "set" : `default (${DEFAULTS.rpcUrl})`, snapshot: snap, checks, version: process.env.npm_package_version ?? null },
    { status: ok ? 200 : 503 }
  );
});
