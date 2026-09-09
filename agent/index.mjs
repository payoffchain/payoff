/**
 * PAYOFF agent runner — the one process that has to stay on.
 *
 *   npm run agent
 *
 * Each tick, for every vault it operates, it asks the site for the plan
 * (GET /api/vaults/<vault>/plan: protect → refinance → close → harvest → deploy, each
 * with calldata) and signs what the plan says with the OPERATOR key. The brain lives in
 * lib/services/plan.ts, on the site, where the UI shows the same plan under "what the
 * agent would do now" — one decision procedure, readable in one place.
 *
 * SAFE BY DEFAULT: dry-run until AGENT_DRY_RUN=false. Every decision is still made,
 * logged and exposed on GET /decisions, so a runner deployed by accident costs nothing.
 *
 * THE KEY THIS HOLDS IS AN OPERATOR KEY. The vault bounds what it can do: no
 * withdrawals to anyone, only the vault's own pair, LTV ceiling, oracle-policed swaps.
 * A leaked operator key can make poor trades inside the pair; it cannot take funds.
 * Still: never point this at an owner or treasury key.
 *
 * Env:
 *   PAYOFF_API_URL       the site (https://...), required
 *   AGENT_PRIVATE_KEY    operator key, required unless AGENT_DRY_RUN=true
 *   RPC_URL              default Robinhood Chain public RPC
 *   AGENT_VAULTS         comma-separated vault addresses; default: every vault whose operator is this key
 *   AGENT_DRY_RUN        default true
 *   AGENT_TICK_MS        default 60000
 *   AGENT_MAX_ACTIONS    per tick, default 3
 *   AGENT_MIN_ETH        refuse to sign below this ETH balance (gas), default 0.0005
 *   AGENT_PLAN_QUERY     query string appended to /plan, e.g. minDeployUsd=10&rangeWidthPct=3 (overrides the site defaults)
 *   PORT                 /health and /decisions, default 3001
 *   ANTHROPIC_API_KEY    optional: a Claude review of each plan (advisory only, see brain.mjs)
 */

import { createServer } from "node:http";
import { ethers } from "ethers";
import { review, hasModel } from "./brain.mjs";

const cfg = {
  apiUrl: (process.env.PAYOFF_API_URL ?? "").replace(/\/$/, ""),
  rpcUrl: process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  chainId: Number(process.env.CHAIN_ID ?? 4663),
  privateKey: process.env.AGENT_PRIVATE_KEY ?? "",
  vaults: (process.env.AGENT_VAULTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  dryRun: process.env.AGENT_DRY_RUN !== "false",
  tickMs: Number(process.env.AGENT_TICK_MS ?? 60_000),
  maxActions: Number(process.env.AGENT_MAX_ACTIONS ?? 3),
  minEth: process.env.AGENT_MIN_ETH ?? "0.0005",
  planQuery: (process.env.AGENT_PLAN_QUERY ?? "").replace(/^[?]/, ""),
  port: Number(process.env.PORT ?? 3001),
};

if (!cfg.apiUrl) {
  console.error("PAYOFF_API_URL is required");
  process.exit(1);
}
if (!cfg.dryRun && !cfg.privateKey) {
  console.error("AGENT_PRIVATE_KEY is required when AGENT_DRY_RUN=false");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, batchMaxCount: 10 });
const wallet = cfg.privateKey ? new ethers.Wallet(cfg.privateKey, provider) : null;
const operator = wallet?.address ?? null;

const state = {
  startedAt: new Date().toISOString(),
  operator,
  dryRun: cfg.dryRun,
  ticks: 0,
  lastTick: null,
  lastError: null,
  consecutiveFailures: 0,
  decisions: [], // newest first, capped
  vaults: [],
};

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

function record(d) {
  state.decisions.unshift({ at: new Date().toISOString(), ...d });
  if (state.decisions.length > 200) state.decisions.length = 200;
}

async function api(path) {
  const res = await fetch(cfg.apiUrl + path, { headers: { accept: "application/json" } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

/** Vaults to operate: env list, else every factory vault whose operator is this key. */
async function discoverVaults() {
  if (cfg.vaults.length) return cfg.vaults;
  if (!operator) return [];
  const { vaults } = await api("/api/vaults");
  return vaults.filter((v) => v.operator.toLowerCase() === operator.toLowerCase() && !v.paused).map((v) => v.address);
}

async function gasOk() {
  if (!wallet) return true;
  const bal = await provider.getBalance(wallet.address);
  return bal >= ethers.parseEther(cfg.minEth);
}

async function execute(action) {
  const { tx } = action.built;
  if (cfg.dryRun || !wallet) return { status: "dry-run" };
  // Simulate first: a revert here costs nothing and names the reason.
  try {
    await provider.call({ to: tx.to, data: tx.data, from: wallet.address });
  } catch (err) {
    return { status: "would-revert", error: err?.shortMessage ?? err?.message ?? String(err) };
  }
  const sent = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value ?? "0") });
  const rc = await sent.wait(1, 120_000);
  return { status: rc?.status === 1 ? "confirmed" : "failed", hash: sent.hash, block: rc?.blockNumber ?? null };
}

async function tick() {
  state.ticks += 1;
  state.lastTick = new Date().toISOString();
  const vaults = await discoverVaults();
  state.vaults = vaults;
  if (vaults.length === 0) {
    log("no vaults to operate", operator ? `(operator ${operator})` : "(no key: set AGENT_VAULTS to plan in dry-run)");
    return;
  }
  const hasGas = await gasOk();
  for (const vault of vaults) {
    let plan;
    try {
      plan = await api(`/api/vaults/${vault}/plan${cfg.planQuery ? "?" + cfg.planQuery : ""}`);
    } catch (err) {
      record({ vault, error: err.message });
      log(vault, "plan failed:", err.message);
      continue;
    }
    if (plan.actions.length === 0) {
      record({ vault, ltv: plan.ltv, actions: [], skipped: plan.skipped });
      log(vault, "nothing to do —", plan.skipped.map((s) => `${s.rule}: ${s.why}`).join("; "));
      continue;
    }
    let advice = null;
    if (hasModel()) {
      try { advice = await review(plan); } catch (err) { advice = { error: err.message }; }
    }
    const results = [];
    for (const action of plan.actions.slice(0, cfg.maxActions)) {
      if (advice?.veto?.includes(action.kind)) {
        results.push({ kind: action.kind, reason: action.reason, status: "vetoed", note: advice.note });
        log(vault, action.kind, "VETOED by review:", advice.note);
        continue;
      }
      if (!hasGas && !cfg.dryRun) {
        results.push({ kind: action.kind, reason: action.reason, status: "no-gas" });
        log(vault, action.kind, "skipped: operator below AGENT_MIN_ETH");
        continue;
      }
      try {
        const r = await execute(action);
        results.push({ kind: action.kind, reason: action.reason, description: action.built.tx.description, ...r });
        log(vault, action.kind, r.status, r.hash ?? "", "—", action.reason);
      } catch (err) {
        results.push({ kind: action.kind, reason: action.reason, status: "error", error: err?.shortMessage ?? err?.message ?? String(err) });
        log(vault, action.kind, "error:", err?.shortMessage ?? err?.message);
      }
    }
    record({ vault, ltv: plan.ltv, actions: results, skipped: plan.skipped, advice });
  }
}

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

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/health") return res.end(JSON.stringify({ ok: state.consecutiveFailures < 5, ...state, decisions: undefined }));
  if (url.pathname === "/decisions") return res.end(JSON.stringify(state.decisions.slice(0, Number(url.searchParams.get("limit") ?? 50))));
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
}).listen(cfg.port, () => log(`agent runner on :${cfg.port} (${cfg.dryRun ? "DRY RUN" : "LIVE"}) operator=${operator ?? "none"} api=${cfg.apiUrl} model=${hasModel() ? "on" : "off"}`));

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
