import { ethers } from "ethers";
import FactoryAbi from "./abis/PayoffVaultFactory.json";
import VaultAbi from "./abis/PayoffVault.json";

/**
 * Chain access for the API layer and the agent's shared helpers.
 *
 * The server holds no key. Every state-changing route returns unsigned calldata that
 * the owner's wallet (or the operator key inside the runner) signs. Reads go through
 * one JSON-RPC provider with small batches (public RPCs stop answering above a few
 * dozen calls per batch) and through Multicall3 wherever a page needs many values.
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

/**
 * Arc (5042) defaults. Every one can be overridden by env. Sources: docs.arc.io
 * (chain, USDC, Multicall3), docs.morpho.org (Morpho Blue + IRM), Uniswap sdk-core
 * ARC_ADDRESSES (v3 factory, SwapRouter02, QuoterV2, position manager).
 */
export const DEFAULTS = {
  chainId: 5042,
  /** Blockdaemon's public Arc endpoint: the one that answers 20k-block log queries (the
   *  official and QuickNode ones cap at 10k, dRPC's free tier lower still). */
  rpcUrl: "https://rpc.blockdaemon.mainnet.arc.io",
  explorer: "https://explorer.arc.io",
  morpho: "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD",
  adaptiveCurveIrm: "0xF02615d094Fc02fC031C35fe705e175aA4653f20",
  uniswapV3Factory: "0xf0db7b58379503491d857db50ac9ece64c653918",
  uniswapV3SwapRouter: "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77",
  uniswapV3Quoter: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468",
  uniswapV3PositionManager: "0x39654a85a4c05127f5fd6ed22caec077a0fb1377",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  /** USDC on Arc: native gas token, with this 6-decimal ERC-20 interface. */
  usdc: "0x3600000000000000000000000000000000000000",
  weth: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB",
  /** Arc makes a block every ~500 ms. */
  blocksPerDay: 172_800,
  /** the largest eth_getLogs range the default RPC accepts */
  logChunkBlocks: 20_000,
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
  usdc: () => envAddress("USDC_ADDRESS", DEFAULTS.usdc),
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
  // A stalled RPC request must not eat a whole serverless budget: ethers' default fetch
  // timeout is 300 s, far past any route's maxDuration. 12 s is generous for one call.
  const req = new ethers.FetchRequest(url);
  req.timeout = Number(process.env.RPC_TIMEOUT_MS ?? 12_000);
  cachedProvider = new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true, batchMaxCount: 10 });
  return cachedProvider;
}

/**
 * The chain id the RPC actually serves. `staticNetwork` skips this on every call for
 * speed, so /api/health asks once explicitly: a mis-pointed RPC_URL otherwise "works"
 * and every read on the site is from the wrong chain.
 */
export async function rpcChainId(): Promise<number> {
  const hex: string = await getProvider().send("eth_chainId", []);
  return parseInt(hex, 16);
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
 * getLogs over a wide range, oldest first. Public RPCs time out a log query
 * over a busy address long before it hits a block limit, so the chunk size adapts:
 * a range that fails is halved and retried, down to `minChunk`, after which the error
 * is the caller's to report.
 */
export async function getLogsChunked(
  filter: { address?: string | string[]; topics?: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
  chunk = Number(process.env.LOG_CHUNK_BLOCKS ?? DEFAULTS.logChunkBlocks),
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

/**
 * Newest-first log scan with a time budget. Returns what it found and how far back
 * it got; `partial` tells the caller the older history was not reached. This is the
 * shape a serverless route needs: bounded, and honest about what it skipped.
 */
export async function getLogsRecent(
  filter: { address?: string | string[]; topics?: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
  opts: { budgetMs?: number; chunk?: number; minChunk?: number } = {}
): Promise<{ logs: ethers.Log[]; scannedFrom: number; partial: boolean }> {
  const provider = getProvider();
  const budget = opts.budgetMs ?? 20_000;
  const minChunk = opts.minChunk ?? 2_000;
  let size = opts.chunk ?? Number(process.env.LOG_CHUNK_BLOCKS ?? DEFAULTS.logChunkBlocks);
  const started = Date.now();
  const logs: ethers.Log[] = [];
  let to = toBlock;
  while (to >= fromBlock) {
    if (Date.now() - started > budget) return { logs, scannedFrom: to + 1, partial: true };
    const from = Math.max(fromBlock, to - size + 1);
    try {
      const part = await provider.getLogs({ ...filter, fromBlock: from, toBlock: to });
      logs.push(...part);
      to = from - 1;
      if (size < (opts.chunk ?? DEFAULTS.logChunkBlocks)) size = Math.min(opts.chunk ?? DEFAULTS.logChunkBlocks, size * 2);
    } catch (err) {
      if (size <= minChunk) return { logs, scannedFrom: to + 1, partial: true };
      size = Math.max(minChunk, Math.floor(size / 2));
    }
  }
  return { logs, scannedFrom: fromBlock, partial: false };
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
    } catch (err) {
      // A waiter on a cold cache has nothing to fall back to; handing it `undefined`
      // just moves the failure into the caller as a TypeError.
      if (hit.at === 0) throw err;
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
