/**
 * PAYOFF agent runner: the one process that has to stay on.
 *
 *   npm run agent
 *
 * Each tick, for every vault it operates, it asks the site for the plan
 * (GET /api/vaults/<vault>/plan: protect → refinance → close → harvest → deploy, each
 * with calldata) and signs what the plan says with the OPERATOR key. The brain lives in
 * lib/services/plan.ts, on the site, where the UI shows the same plan under "what the
 * agent would do now": one decision procedure, readable in one place.
 *
 * THE RUNNER DOES NOT TRUST THE SITE. Before anything is signed the calldata is decoded
 * against the vault ABI and must be (a) addressed to a vault this runner operates,
 * (b) one of the five operator functions, matching the action's kind, (c) worth zero
 * ETH, and (d) inside its deadline. A compromised or mistaken API can therefore make the
 * runner do nothing, or do a vault action the contract already bounds; it cannot make
 * the operator key pay anyone or call anything else.
 *
 * SAFE BY DEFAULT: dry-run until AGENT_DRY_RUN=false. Every decision is still made,
 * simulated, logged and exposed on GET /decisions, so a runner deployed by accident
 * costs nothing and shows what it would have done.
 *
 * THE KEY THIS HOLDS IS AN OPERATOR KEY. The vault bounds what it can do: no
 * withdrawals to anyone, only the vault's own pair, LTV ceiling, oracle-policed swaps.
 * At startup the runner reads each vault's owner and operator and refuses to run with
 * an owner key.
 *
 * Env:
 *   PAYOFF_API_URL       the site, https:// (http only for localhost), required
 *   AGENT_PRIVATE_KEY    operator key, required unless AGENT_DRY_RUN=true
 *   RPC_URL              default Robinhood Chain public RPC
 *   CHAIN_ID             default 4663; the RPC must agree
 *   PAYOFF_FACTORY_ADDRESS  the factory, used to confirm each vault is a real clone (optional but recommended)
 *   AGENT_VAULTS         comma-separated vault addresses; default: every vault whose operator is this key
 *   AGENT_DRY_RUN        default true
 *   AGENT_TICK_MS        default 60000
 *   AGENT_MAX_ACTIONS    per tick, default 3
 *   AGENT_MIN_ETH        refuse to sign below this ETH balance (gas), default 0.0005
 *   AGENT_PLAN_QUERY     query string appended to /plan, e.g. minDeployUsd=10&rangeWidthPct=3
 *   AGENT_PLAN_MAX_AGE_S refuse a plan older than this, default 45
 *   AGENT_STUCK_MIN      replace a pending transaction after this many minutes, default 3
 *   HOST / PORT          /health and /decisions; default 127.0.0.1:3001
 *   ANTHROPIC_API_KEY    optional: a Claude review of each plan (advisory only, see brain.mjs)
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { review, hasModel } from "./brain.mjs";
import { vetTx as vet } from "./vet.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const VAULT_ABI = JSON.parse(readFileSync(join(here, "..", "lib", "abis", "PayoffVault.json"), "utf8"));
const FACTORY_ABI = JSON.parse(readFileSync(join(here, "..", "lib", "abis", "PayoffVaultFactory.json"), "utf8"));
const vaultIface = new ethers.Interface(VAULT_ABI);

// --- configuration, validated once ---------------------------------------------------

function num(name, dflt, { min = 0, integer = true } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) fail(`${name} must be a${integer ? "n integer" : " number"} >= ${min}, got "${raw}"`);
  return n;
}
function fail(msg) {
  console.error("config:", msg);
  process.exit(1);
}

const cfg = {
  apiUrl: (process.env.PAYOFF_API_URL ?? "").replace(/\/$/, ""),
  rpcUrl: process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  chainId: num("CHAIN_ID", 4663, { min: 1 }),
  privateKey: process.env.AGENT_PRIVATE_KEY ?? "",
  factory: process.env.PAYOFF_FACTORY_ADDRESS ?? "",
  vaults: (process.env.AGENT_VAULTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  dryRun: process.env.AGENT_DRY_RUN !== "false",
  tickMs: num("AGENT_TICK_MS", 60_000, { min: 5_000 }),
  maxActions: num("AGENT_MAX_ACTIONS", 3, { min: 1 }),
  minEth: process.env.AGENT_MIN_ETH ?? "0.0005",
  planQuery: (process.env.AGENT_PLAN_QUERY ?? "").replace(/^[?]/, ""),
  planMaxAgeS: num("AGENT_PLAN_MAX_AGE_S", 45, { min: 5 }),
  stuckMin: num("AGENT_STUCK_MIN", 3, { min: 1 }),
  host: process.env.HOST ?? "127.0.0.1",
  port: num("PORT", 3001, { min: 1 }),
};

if (!cfg.apiUrl) fail("PAYOFF_API_URL is required");
{
  let u;
  try { u = new URL(cfg.apiUrl); } catch { fail("PAYOFF_API_URL is not a URL"); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) fail("PAYOFF_API_URL must be https:// (plain http is only allowed for localhost): the plan is what this key signs");
}
if (!cfg.dryRun && !cfg.privateKey) fail("AGENT_PRIVATE_KEY is required when AGENT_DRY_RUN=false");
for (const v of cfg.vaults) if (!ethers.isAddress(v)) fail(`AGENT_VAULTS entry is not an address: ${v}`);
if (cfg.factory && !ethers.isAddress(cfg.factory)) fail("PAYOFF_FACTORY_ADDRESS is not an address");
try { ethers.parseEther(cfg.minEth); } catch { fail(`AGENT_MIN_ETH is not a number: ${cfg.minEth}`); }

const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, batchMaxCount: 10 });
const wallet = cfg.privateKey ? new ethers.Wallet(cfg.privateKey, provider) : null;
const operator = wallet?.address ?? null;

// --- state ------------------------------------------------------------------------------

const state = {
  startedAt: new Date().toISOString(),
  operator,
  dryRun: cfg.dryRun,
  chainId: cfg.chainId,
  ticks: 0,
  lastTick: null,
  lastError: null,
  consecutiveFailures: 0,
  ethBalance: null,
  lowGas: false,
  pending: null,        // { hash, nonce, sentAt, vault, kind } while a transaction is in flight
  decisions: [],        // newest first, capped
  vaults: [],
  verified: {},         // vault -> { owner, operator, ok, why }
};
const lastVaultList = { at: 0, vaults: [] };
const recent = new Map();   // `${vault}:${dataHash}` -> { at, status }: identical calldata is not re-sent inside a cooldown
const cooldown = new Map(); // `${vault}:${kind}` -> until (ms): after an on-chain failure, back off that action

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}
function record(d) {
  state.decisions.unshift({ at: new Date().toISOString(), ...d });
  if (state.decisions.length > 200) state.decisions.length = 200;
}

async function api(path) {
  const res = await fetch(cfg.apiUrl + path, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

// --- what may be signed: see vet.mjs (pure, unit-tested) ---------------------------------

// --- vaults ------------------------------------------------------------------------------

/** Vaults to operate: env list, else every factory vault whose operator is this key. Falls back to the last good list. */
async function discoverVaults() {
  if (cfg.vaults.length) return cfg.vaults;
  if (!operator) return [];
  try {
    const { vaults } = await api("/api/vaults");
    const mine = vaults.filter((v) => typeof v?.operator === "string" && v.operator.toLowerCase() === operator.toLowerCase() && !v.paused).map((v) => v.address);
    lastVaultList.at = Date.now();
    lastVaultList.vaults = mine;
    return mine;
  } catch (err) {
    if (lastVaultList.vaults.length) { log("vault discovery failed, using the last list:", err.message); return lastVaultList.vaults; }
    throw err;
  }
}

/**
 * On-chain facts about a vault, checked once and refreshed hourly: it is a factory clone
 * (when the factory is known), its operator is this key, and its owner is NOT this key.
 */
async function verifyVault(vault) {
  const cached = state.verified[vault];
  if (cached && Date.now() - cached.at < 3600_000) return cached;
  const c = new ethers.Contract(vault, VAULT_ABI, provider);
  const out = { at: Date.now(), ok: false, why: null, owner: null, operator: null };
  try {
    if (cfg.factory) {
      const f = new ethers.Contract(cfg.factory, FACTORY_ABI, provider);
      if (!(await f.isVault(vault))) { out.why = "not a vault of PAYOFF_FACTORY_ADDRESS"; state.verified[vault] = out; return out; }
    }
    const [owner, op] = await Promise.all([c.owner(), c.operator()]);
    out.owner = owner;
    out.operator = op;
    if (operator && owner.toLowerCase() === operator.toLowerCase()) { out.why = "AGENT_PRIVATE_KEY is this vault's OWNER key; the runner must hold the operator key"; state.verified[vault] = out; return out; }
    if (operator && op.toLowerCase() !== operator.toLowerCase()) { out.why = `vault operator is ${op}, this key is ${operator}`; state.verified[vault] = out; return out; }
    out.ok = true;
  } catch (err) {
    // A read error is not a verdict: do not cache it, or one RPC hiccup would leave the
    // vault refused (and unprotected) for an hour. Ask again next tick.
    out.why = `could not read the vault: ${err?.shortMessage ?? err?.message}`;
    return out;
  }
  state.verified[vault] = out;
  return out;
}

// --- gas and nonces --------------------------------------------------------------------

async function gasOk() {
  if (!wallet) return true;
  try {
    const bal = await provider.getBalance(wallet.address);
    state.ethBalance = ethers.formatEther(bal);
    const ok = bal >= ethers.parseEther(cfg.minEth);
    if (state.lowGas !== !ok) log(ok ? "gas ok:" : "LOW GAS:", state.ethBalance, "ETH");
    state.lowGas = !ok;
    return ok;
  } catch (err) {
    log("balance read failed, treating as no gas this tick:", err?.shortMessage ?? err?.message);
    return false;
  }
}

/**
 * A transaction that was sent but not mined occupies the nonce; everything after it
 * queues. Nothing new is signed while one is pending, and one that has sat longer than
 * AGENT_STUCK_MIN is replaced with an empty self-transfer at a higher fee.
 */
async function settlePending() {
  if (!wallet) return true;
  const [latest, pending] = await Promise.all([provider.getTransactionCount(wallet.address, "latest"), provider.getTransactionCount(wallet.address, "pending")]);
  if (pending <= latest) { if (state.pending) log("pending tx cleared", state.pending.hash); state.pending = null; return true; }
  const p = state.pending ?? { hash: null, nonce: latest, sentAt: Date.now(), vault: null, kind: null };
  state.pending = p;
  const ageMin = (Date.now() - p.sentAt) / 60_000;
  if (ageMin < cfg.stuckMin) { log(`waiting on pending nonce ${p.nonce} (${ageMin.toFixed(1)} min)`, p.hash ?? ""); return false; }
  try {
    const fee = await provider.getFeeData();
    const bump = (x) => (x ? (x * 125n) / 100n : undefined);
    const cancel = await wallet.sendTransaction({ to: wallet.address, value: 0n, nonce: p.nonce, maxFeePerGas: bump(fee.maxFeePerGas), maxPriorityFeePerGas: bump(fee.maxPriorityFeePerGas), gasPrice: fee.maxFeePerGas ? undefined : bump(fee.gasPrice) });
    log(`replacing stuck nonce ${p.nonce} with ${cancel.hash}`);
    state.pending = { hash: cancel.hash, nonce: p.nonce, sentAt: Date.now(), vault: p.vault, kind: "cancel" };
  } catch (err) {
    log("replacement failed:", err?.shortMessage ?? err?.message);
  }
  return false;
}

// --- execution --------------------------------------------------------------------------

async function revertReason(tx, blockNumber) {
  try {
    await provider.call({ to: tx.to, data: tx.data, from: wallet.address, blockTag: blockNumber });
    return "no reason (state changed between simulation and inclusion)";
  } catch (err) {
    return err?.shortMessage ?? err?.reason ?? err?.message ?? String(err);
  }
}

async function execute(vault, action) {
  const { tx } = action.built;
  const key = `${vault}:${ethers.keccak256(tx.data)}`;
  const seen = recent.get(key);
  if (seen && Date.now() - seen.at < cfg.tickMs * 3) return { status: "skipped", error: `identical calldata was ${seen.status} ${Math.round((Date.now() - seen.at) / 1000)}s ago` };
  const cd = cooldown.get(`${vault}:${action.kind}`);
  if (cd && Date.now() < cd) return { status: "cooldown", error: `${action.kind} failed on chain recently; retrying after ${new Date(cd).toISOString()}` };

  // Simulate first, in dry-run too: a revert here costs nothing and names the reason.
  const from = wallet?.address ?? ethers.ZeroAddress;
  try {
    await provider.call({ to: tx.to, data: tx.data, from });
  } catch (err) {
    return { status: "would-revert", error: err?.shortMessage ?? err?.reason ?? err?.message ?? String(err) };
  }
  if (cfg.dryRun || !wallet) return { status: "dry-run" };

  const sent = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
  state.pending = { hash: sent.hash, nonce: sent.nonce, sentAt: Date.now(), vault, kind: action.kind };
  recent.set(key, { at: Date.now(), status: "sent" });
  let rc;
  try {
    rc = await sent.wait(1, 120_000);
  } catch (err) {
    // Not mined within two minutes. The nonce is still occupied; settlePending() handles it.
    return { status: "pending", hash: sent.hash, nonce: sent.nonce, error: err?.shortMessage ?? err?.message };
  }
  state.pending = null;
  if (rc?.status === 1) {
    recent.set(key, { at: Date.now(), status: "confirmed" });
    return { status: "confirmed", hash: sent.hash, block: rc.blockNumber, gasUsed: rc.gasUsed?.toString() };
  }
  const reason = await revertReason(tx, rc?.blockNumber);
  const fails = (cooldown.get(`${vault}:${action.kind}:n`) ?? 0) + 1;
  cooldown.set(`${vault}:${action.kind}:n`, fails);
  cooldown.set(`${vault}:${action.kind}`, Date.now() + cfg.tickMs * Math.min(32, 2 ** fails));
  recent.set(key, { at: Date.now(), status: "failed" });
  return { status: "failed", hash: sent.hash, block: rc?.blockNumber ?? null, gasUsed: rc?.gasUsed?.toString(), error: reason };
}

// --- the tick -----------------------------------------------------------------------------

async function tick() {
  state.ticks += 1;
  state.lastTick = new Date().toISOString();
  const vaults = await discoverVaults();
  state.vaults = vaults;
  // gas is checked every tick, vaults or not, so /health always shows the balance and
  // an empty wallet is noticed before the first vault arrives
  const hasGas = await gasOk();
  if (vaults.length === 0) {
    log("no vaults to operate", operator ? `(operator ${operator})` : "(no key: set AGENT_VAULTS to plan in dry-run)");
    return;
  }
  const canSign = !cfg.dryRun && wallet && (await settlePending());

  for (const vault of vaults) {
    const ver = await verifyVault(vault);
    if (!ver.ok) {
      record({ vault, error: ver.why });
      log(vault, "REFUSED:", ver.why);
      continue;
    }
    let plan;
    try {
      plan = await api(`/api/vaults/${vault}/plan${cfg.planQuery ? "?" + cfg.planQuery : ""}`);
    } catch (err) {
      record({ vault, error: err.message });
      log(vault, "plan failed:", err.message);
      continue;
    }
    const ageS = plan.at ? (Date.now() - Date.parse(plan.at)) / 1000 : Infinity;
    if (!(ageS <= cfg.planMaxAgeS)) {
      record({ vault, error: `plan is ${Number.isFinite(ageS) ? Math.round(ageS) + "s" : "undated"}; refusing anything older than ${cfg.planMaxAgeS}s` });
      log(vault, "stale plan, skipped");
      continue;
    }
    if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
      record({ vault, ltv: plan.ltv, actions: [], skipped: plan.skipped });
      log(vault, "nothing to do:", (plan.skipped ?? []).map((s) => `${s.rule}: ${s.why}`).join("; "));
      continue;
    }
    let advice = null;
    if (hasModel()) {
      try { advice = await review(plan); } catch (err) { advice = { veto: [], error: err.message }; }
    }
    const results = [];
    let executed = 0;
    for (const action of plan.actions) {
      if (executed >= cfg.maxActions) break;
      const why = vet(vaultIface, vault, action);
      if (why) {
        results.push({ kind: action.kind, reason: action.reason, status: "rejected", error: why });
        log(vault, action.kind, "REJECTED before signing:", why);
        continue;
      }
      // The model may delay anything except liquidation protection: that is the one
      // action where "wait a tick" can cost the whole position.
      if (action.kind !== "protect" && advice?.veto?.includes(action.kind)) {
        results.push({ kind: action.kind, reason: action.reason, status: "vetoed", note: advice.note });
        log(vault, action.kind, "VETOED by review:", advice.note);
        continue;
      }
      if (!cfg.dryRun && !hasGas) {
        results.push({ kind: action.kind, reason: action.reason, status: "no-gas" });
        log(vault, action.kind, "skipped: operator below AGENT_MIN_ETH");
        continue;
      }
      if (!cfg.dryRun && !canSign) {
        results.push({ kind: action.kind, reason: action.reason, status: "waiting", error: "a transaction is still pending" });
        continue;
      }
      try {
        const r = await execute(vault, action);
        results.push({ kind: action.kind, reason: action.reason, description: action.built.tx.description, ...r });
        log(vault, action.kind, r.status, r.hash ?? "", r.error ? `(${r.error})` : "", "—", action.reason);
        if (r.status === "confirmed" || r.status === "failed" || r.status === "pending" || r.status === "dry-run") executed += 1;
        if (r.status === "pending") break; // nothing more this tick
      } catch (err) {
        results.push({ kind: action.kind, reason: action.reason, status: "error", error: err?.shortMessage ?? err?.message ?? String(err) });
        log(vault, action.kind, "error:", err?.shortMessage ?? err?.message);
      }
    }
    record({ vault, ltv: plan.ltv, actions: results, skipped: plan.skipped, advice });
  }
}

// --- lifecycle -----------------------------------------------------------------------------

let stopping = false;
let inFlight = null;

async function loop() {
  while (!stopping) {
    inFlight = tick()
      .then(() => { state.lastError = null; state.consecutiveFailures = 0; })
      .catch((err) => {
        state.lastError = err?.message ?? String(err);
        state.consecutiveFailures += 1;
        log("tick failed:", state.lastError);
      });
    await inFlight;
    inFlight = null;
    const backoff = Math.min(8, 2 ** state.consecutiveFailures);
    await new Promise((r) => setTimeout(r, cfg.tickMs * backoff));
  }
}

async function main() {
  // The RPC must serve the chain we think it does; staticNetwork skips this otherwise.
  const cid = parseInt(await provider.send("eth_chainId", []), 16);
  if (cid !== cfg.chainId) fail(`RPC_URL serves chain ${cid}, CHAIN_ID is ${cfg.chainId}`);

  createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*"); // read-only status, safe to show on the site
    if (url.pathname === "/health") return res.end(JSON.stringify({ ok: state.consecutiveFailures < 5 && !state.lowGas, ...state, decisions: undefined }));
    if (url.pathname === "/decisions") return res.end(JSON.stringify(state.decisions.slice(0, Number(url.searchParams.get("limit") ?? 50))));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  }).listen(cfg.port, cfg.host, () => log(`agent runner on ${cfg.host}:${cfg.port} (${cfg.dryRun ? "DRY RUN" : "LIVE"}) operator=${operator ?? "none"} api=${cfg.apiUrl} model=${hasModel() ? "on" : "off"}`));

  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      log(`${sig}: finishing the tick in flight, then exiting`);
      if (inFlight) await inFlight.catch(() => {});
      process.exit(0);
    });
  }
  loop();
}

main().catch((err) => { console.error("startup failed:", err?.shortMessage ?? err?.message ?? err); process.exit(1); });
