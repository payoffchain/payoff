import { ethers } from "ethers";
import FactoryAbi from "./abis/PayoffVaultFactory.json";
import VaultAbi from "./abis/PayoffVault.json";

/**
 * Chain access for the API layer and the agent's shared helpers.
 *
 * The server holds no key. Every state-changing route returns unsigned calldata that
 * the owner's wallet (or the operator key inside the runner) signs. Reads go through
 * one JSON-RPC provider with small batches (the Robinhood RPC stops answering above a
 * few dozen calls per batch) and through Multicall3 wherever a page needs many values.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new ConfigError(`Missing env var ${name}`);
  return v || "";
}

export function envAddress(name: string, fallback?: string): string {
  const v = process.env[name] || fallback || "";
  if (!v) throw new ConfigError(`Missing env var ${name}`);
  if (!ethers.isAddress(v)) throw new ConfigError(`Env var ${name} is not a valid address`);
  return ethers.getAddress(v);
}

/** Robinhood Chain (4663) defaults. Every one can be overridden by env. */
export const DEFAULTS = {
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  morpho: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010",
  adaptiveCurveIrm: "0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1",
  uniswapV3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  uniswapV3SwapRouter: "0xcaf681a66d020601342297493863e78c959e5cb2",
  uniswapV3Quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  uniswapV3PositionManager: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  /** Robinhood Chain makes a block every ~100 ms. */
  blocksPerDay: 864_000,
};

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? DEFAULTS.chainId);

export const ADDR = {
  morpho: () => envAddress("MORPHO_ADDRESS", DEFAULTS.morpho),
  irm: () => envAddress("ADAPTIVE_CURVE_IRM", DEFAULTS.adaptiveCurveIrm),
  uniFactory: () => envAddress("UNISWAP_V3_FACTORY", DEFAULTS.uniswapV3Factory),
  swapRouter: () => envAddress("UNISWAP_V3_SWAP_ROUTER", DEFAULTS.uniswapV3SwapRouter),
  quoter: () => envAddress("UNISWAP_V3_QUOTER", DEFAULTS.uniswapV3Quoter),
  positionManager: () => envAddress("UNISWAP_V3_POSITION_MANAGER", DEFAULTS.uniswapV3PositionManager),
  multicall3: () => envAddress("MULTICALL3_ADDRESS", DEFAULTS.multicall3),
  usdg: () => envAddress("USDG_ADDRESS", DEFAULTS.usdg),
  factory: () => envAddress("PAYOFF_FACTORY_ADDRESS"),
  factoryOrNull: () => {
    const v = process.env.PAYOFF_FACTORY_ADDRESS;
    return v && ethers.isAddress(v) ? ethers.getAddress(v) : null;
  },
};

export const BLOCKS_PER_DAY = Number(process.env.BLOCKS_PER_DAY ?? DEFAULTS.blocksPerDay);
export const EXPLORER = (process.env.NEXT_PUBLIC_EXPLORER_URL ?? DEFAULTS.explorer).replace(/\/$/, "");

let cachedProvider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (cachedProvider) return cachedProvider;
  if (!Number.isInteger(CHAIN_ID) || CHAIN_ID <= 0) throw new ConfigError("CHAIN_ID must be a positive integer");
  const url = process.env.RPC_URL || DEFAULTS.rpcUrl;
  cachedProvider = new ethers.JsonRpcProvider(url, CHAIN_ID, { staticNetwork: true, batchMaxCount: 10 });
  return cachedProvider;
}

export const factoryIface = new ethers.Interface(FactoryAbi);
export const vaultIface = new ethers.Interface(VaultAbi);

export function factoryContract() {
  return new ethers.Contract(ADDR.factory(), FactoryAbi, getProvider());
}

export function vaultContract(address: string) {
  if (!ethers.isAddress(address)) throw new ConfigError(`not an address: ${address}`);
  return new ethers.Contract(address, VaultAbi, getProvider());
}

// --- multicall -----------------------------------------------------------------

export type Call = { target: string; callData: string; allowFailure?: boolean };
export type CallResult = { success: boolean; returnData: string };

const MULTICALL_ABI = [
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])",
];

/** One eth_call for many reads. Failures are per-call (allowFailure = true by default). */
export async function multicall(calls: Call[], opts: { blockTag?: ethers.BlockTag; chunk?: number } = {}): Promise<CallResult[]> {
  if (calls.length === 0) return [];
  const mc = new ethers.Contract(ADDR.multicall3(), MULTICALL_ABI, getProvider());
  const chunk = opts.chunk ?? 150;
  const out: CallResult[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const slice = calls.slice(i, i + chunk).map((c) => ({ target: c.target, allowFailure: c.allowFailure ?? true, callData: c.callData }));
    const res: Array<{ success: boolean; returnData: string }> = await mc.aggregate3(slice, { blockTag: opts.blockTag });
    for (const r of res) out.push({ success: r.success, returnData: r.returnData });
  }
  return out;
}

/** Decode a multicall result with an interface, or null on failure / empty data. */
export function decode(iface: ethers.Interface, fn: string, r: CallResult | undefined): ethers.Result | null {
  if (!r || !r.success || !r.returnData || r.returnData === "0x") return null;
  try {
    return iface.decodeFunctionResult(fn, r.returnData);
  } catch {
    return null;
  }
}

// --- getLogs in chunks -----------------------------------------------------------

/**
 * getLogs over a wide range, oldest first. The Robinhood RPC times out a log query
 * over a busy address long before it hits a block limit, so the chunk size adapts:
 * a range that fails is halved and retried, down to `minChunk`, after which the error
 * is the caller's to report.
 */
export async function getLogsChunked(
  filter: { address?: string | string[]; topics?: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
  chunk = Number(process.env.LOG_CHUNK_BLOCKS ?? 100_000),
  minChunk = 2_000
): Promise<ethers.Log[]> {
  const provider = getProvider();
  const logs: ethers.Log[] = [];
  let size = chunk;
  let from = fromBlock;
  while (from <= toBlock) {
    const to = Math.min(from + size - 1, toBlock);
    try {
      const part = await provider.getLogs({ ...filter, fromBlock: from, toBlock: to });
      logs.push(...part);
      from = to + 1;
      // grow back slowly after a shrink
      if (size < chunk) size = Math.min(chunk, size * 2);
    } catch (err) {
      if (size <= minChunk) throw err;
      size = Math.max(minChunk, Math.floor(size / 2));
    }
  }
  return logs;
}

// --- tiny in-process cache -------------------------------------------------------

const cache = new Map<string, { at: number; value: unknown; pending?: Promise<unknown> }>();

/**
 * Memoize an async read for `ttlMs`. A refresh that fails serves the last good value
 * (with its age available to the caller via `cachedAt`) rather than an error, so one
 * blip at the RPC or the Morpho API does not blank a page.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<{ value: T; cachedAt: number; stale: boolean }> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return { value: hit.value as T, cachedAt: hit.at, stale: false };
  if (hit?.pending) {
    try {
      const v = (await hit.pending) as T;
      return { value: v, cachedAt: Date.now(), stale: false };
    } catch {
      return { value: hit.value as T, cachedAt: hit.at, stale: true };
    }
  }
  const pending = fn();
  cache.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
  try {
    const value = await pending;
    cache.set(key, { at: Date.now(), value });
    return { value, cachedAt: Date.now(), stale: false };
  } catch (err) {
    if (hit) {
      cache.set(key, { at: hit.at, value: hit.value });
      return { value: hit.value as T, cachedAt: hit.at, stale: true };
    }
    cache.delete(key);
    throw err;
  }
}
