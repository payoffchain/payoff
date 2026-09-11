"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import Nav from "../components/Nav";
import { useLive } from "../components/useLive";
import { useWallet } from "../components/WalletProvider";
import { useTx } from "../components/useTx";
import { Tok, TxLink, pct } from "../components/ui";
import { usd } from "../components/format";
import { CHAIN_NAME, FACTORY } from "../components/brand";
import FactoryAbi from "@/lib/abis/PayoffVaultFactory.json";

/**
 * Deploy an agent in five steps, without handing a key to anyone:
 *   1. connect the wallet that will OWN the vault
 *   2. pick the collateral and the Morpho market to borrow from
 *   3. set the policy: LTV ceiling, protection trigger, repay share, slippage
 *   4. make (in this browser) or paste the OPERATOR key the runner will sign with
 *   5. sign createVault; then fund it and borrow from the vault page
 */

type Row = { id: string; lltv: number; listed: boolean; borrowApy: number | null; utilization: number; liquidityUsd: number; totalSupplyUsd: number; collateralPrice: number | null; oracleSuspect?: boolean };
type Group = { collateral: { address: string; symbol: string; isStock: boolean }; best: Row | null; rows: Row[] };
type Board = { live: boolean; groups: Group[] };

const PRESETS = {
  careful: { label: "Careful", maxLtvBps: 3500, triggerLtvBps: 5000, repayBps: 3000, maxSlippageBps: 100, blurb: "Borrow to 35%. Protect at 50%." },
  balanced: { label: "Balanced", maxLtvBps: 4500, triggerLtvBps: 5500, repayBps: 2500, maxSlippageBps: 100, blurb: "Borrow to 45%. Protect at 55%." },
  bold: { label: "Bold", maxLtvBps: 5500, triggerLtvBps: 6000, repayBps: 2500, maxSlippageBps: 150, blurb: "Borrow to 55%. Protect at 60%. Needs an LLTV of 77% or more." },
};

function DeployInner() {
  const params = useSearchParams();
  const w = useWallet();
  const tx = useTx();
  const board = useLive<Board>("/api/markets", { live: false, groups: [] });
  const [stocksOnly, setStocksOnly] = useState(true);
  const [collateral, setCollateral] = useState<string>("");
  const [marketId, setMarketId] = useState<string>(params.get("market") ?? "");
  const [preset, setPreset] = useState<keyof typeof PRESETS>("balanced");
  const [policy, setPolicy] = useState({ ...PRESETS.balanced });
  const [opMode, setOpMode] = useState<"generate" | "paste">("generate");
  const [generated, setGenerated] = useState<{ address: string; privateKey: string } | null>(null);
  const [pasted, setPasted] = useState("");
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [vault, setVault] = useState<string | null>(null);

  const groups = useMemo(() => (board.data?.groups ?? []).filter((g) => !stocksOnly || g.collateral.isStock), [board.data, stocksOnly]);
  const group = groups.find((g) => g.collateral.address.toLowerCase() === collateral.toLowerCase()) ?? (board.data?.groups ?? []).find((g) => g.rows.some((r) => r.id === marketId));
  const market = group?.rows.find((r) => r.id === marketId) ?? null;

  useEffect(() => {
    if (marketId && !collateral && board.data) {
      const g = board.data.groups.find((x) => x.rows.some((r) => r.id === marketId));
      if (g) setCollateral(g.collateral.address);
    }
  }, [marketId, collateral, board.data]);
  const [custom, setCustom] = useState(false);
  useEffect(() => { if (!custom) setPolicy({ ...PRESETS[preset] }); }, [preset, custom]);
  function editPolicy(k: keyof typeof policy, v: number) { setCustom(true); setPolicy({ ...policy, [k]: v }); }

  const operator = opMode === "generate" ? generated?.address ?? "" : ethers.isAddress(pasted) ? ethers.getAddress(pasted) : "";
  const lltvOk = market ? policy.triggerLtvBps < market.lltv * 10_000 : true;
  // The same rules the contract enforces, so a bad policy fails here with a sentence
  // instead of at the last step with a wallet error.
  const policyProblem = (() => {
    const p = policy;
    for (const k of ["maxLtvBps", "triggerLtvBps", "repayBps", "maxSlippageBps"] as const) if (!Number.isFinite(p[k]) || p[k] < 0) return "every field needs a number";
    if (p.maxLtvBps > 9500) return "the borrow ceiling cannot exceed 95%";
    if (p.triggerLtvBps < p.maxLtvBps) return "the protection trigger must be at or above the borrow ceiling";
    if (p.triggerLtvBps > 10_000) return "the trigger cannot exceed 100%";
    if (!lltvOk) return `the trigger must sit below the market's liquidation threshold (${((market?.lltv ?? 0) * 100).toFixed(0)}%); otherwise Morpho liquidates before the agent can act`;
    if (p.repayBps <= 0 || p.repayBps > 10_000) return "the repay share must be between 0.01% and 100%";
    if (p.maxSlippageBps < 10) return "slippage must be at least 0.1%, or no swap could ever clear the pool fee";
    if (p.maxSlippageBps > 2000) return "slippage cannot exceed 20%";
    return null;
  })();
  const ready = !!w.address && !w.wrongChain && !!market && !!operator && !policyProblem && (opMode !== "generate" || saved) && !!FACTORY && !vault;

  function generate() {
    const k = ethers.Wallet.createRandom();
    setGenerated({ address: k.address, privateKey: k.privateKey });
    setSaved(false);
    setRevealed(false);
    setCopied(null);
  }

  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked; the text is selectable */ }
  }

  async function create() {
    const hash = await tx.run("/api/tx/create", { marketId, operator, policy: { maxLtvBps: policy.maxLtvBps, triggerLtvBps: policy.triggerLtvBps, repayBps: policy.repayBps, maxSlippageBps: policy.maxSlippageBps } });
    if (!hash) return;
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const rc = await provider.waitForTransaction(hash, 1, 120_000);
      const iface = new ethers.Interface(FactoryAbi);
      for (const l of rc?.logs ?? []) {
        try { const ev = iface.parseLog(l as any); if (ev?.name === "VaultCreated") { setVault(ev.args.vault); break; } } catch { /* other log */ }
      }
    } catch { /* the dashboard lists it anyway */ }
    // The private key has done its job once the vault exists; keep only the address.
    setGenerated((g) => (g ? { address: g.address, privateKey: "" } : g));
    setRevealed(false);
  }

  return (
    <main className="wrap" style={{ padding: "48px 24px 80px", maxWidth: 860 }}>
      <span className="eyebrow">Deploy an agent</span>
      <h2>A vault only you can empty. An agent that can only make it shrink.</h2>
      {!FACTORY && <p className="note warn" style={{ marginTop: 18 }}>The vault factory is not deployed on this site yet (NEXT_PUBLIC_PAYOFF_FACTORY_ADDRESS is unset). You can walk through the steps; the final signature is disabled.</p>}

      <div className="steps" style={{ marginTop: 28 }}>
        <div className="step">
          <div>
            <h3>Connect the owner wallet</h3>
            <p>This wallet owns the vault: it is the only address the vault will ever pay out to.</p>
            <div className="row" style={{ marginTop: 10 }}>
              {w.address ? <span className="pill g">{w.address}</span> : <button className="btn sm primary" onClick={w.connect}>Connect wallet</button>}
              {w.wrongChain && <button className="btn sm danger" onClick={w.switchChain}>Switch to {CHAIN_NAME}</button>}
            </div>
          </div>
        </div>

        <div className="step">
          <div>
            <h3>Pick the collateral and the market</h3>
            <p>One vault is one pair. Every Morpho market of that pair can be allow-listed later for refinancing; you start in one.</p>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="seg"><button className={stocksOnly ? "on" : ""} onClick={() => setStocksOnly(true)}>Stocks</button><button className={!stocksOnly ? "on" : ""} onClick={() => setStocksOnly(false)}>All</button></div>
              <select value={collateral} onChange={(e) => { setCollateral(e.target.value); const g = groups.find((x) => x.collateral.address === e.target.value); setMarketId(g?.best?.id ?? g?.rows[0]?.id ?? ""); }} style={{ padding: "8px 12px", border: "1px solid var(--rule-2)", borderRadius: 10, background: "#fff" }}>
                <option value="">Choose collateral…</option>
                {groups.map((g) => <option key={g.collateral.address} value={g.collateral.address}>{g.collateral.symbol}{g.best ? ` — best ${pct(g.best.borrowApy)} at LLTV ${(g.best.lltv * 100).toFixed(0)}%` : " — no liquidity"}</option>)}
              </select>
            </div>
            {group && (
              <div className="tblwrap" style={{ marginTop: 12 }}>
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th></th><th>Market</th><th className="r">LLTV</th><th className="r">Borrow APY</th><th className="r">Available</th><th className="r">Supplied</th></tr></thead>
                  <tbody>
                    {group.rows.map((r) => (
                      <tr key={r.id} onClick={() => setMarketId(r.id)} style={{ cursor: "pointer" }}>
                        <td><input type="radio" name="market" checked={marketId === r.id} onChange={() => setMarketId(r.id)} aria-label={`market ${r.id.slice(0, 10)}`} /></td>
                        <td className="mono">{r.id.slice(0, 10)}… {group.best?.id === r.id && <span className="pill g">best</span>} {r.oracleSuspect && <span className="pill r">oracle?</span>}</td>
                        <td className="r">{(r.lltv * 100).toFixed(1)}%</td>
                        <td className="r">{pct(r.borrowApy)}</td>
                        <td className="r">{usd(r.liquidityUsd)}</td>
                        <td className="r">{usd(r.totalSupplyUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {market && market.liquidityUsd < 100 && <p className="note warn" style={{ marginTop: 10 }}>This market has almost no USDG to lend right now. You can still create the vault and borrow once someone supplies — or pick another market of the pair.</p>}
          </div>
        </div>

        <div className="step">
          <div>
            <h3>Set the policy</h3>
            <p>Enforced by the vault, not by trust. The operator cannot borrow past the ceiling; protection fires at the trigger; every swap is floored at the oracle less the slippage.</p>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="seg">{(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((k) => <button key={k} className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{PRESETS[k].label}</button>)}</div>
              <span className="faint" style={{ fontSize: 12 }}>{PRESETS[preset].blurb}</span>
            </div>
            <div className="grid g4" style={{ marginTop: 14, gap: 12 }}>
              {([["maxLtvBps", "Borrow ceiling (LTV)"], ["triggerLtvBps", "Protect at (LTV)"], ["repayBps", "Repay share"], ["maxSlippageBps", "Max slippage"]] as const).map(([k, label]) => (
                <div className="field" key={k} style={{ marginBottom: 0 }}>
                  <label>{label}</label>
                  <input type="number" value={Number.isFinite(policy[k]) ? (policy[k] / 100).toString() : ""} min={0} max={100} step={k === "maxSlippageBps" ? 0.1 : 0.5} onChange={(e) => editPolicy(k, e.target.value === "" ? NaN : Math.round(Number(e.target.value) * 100))} />
                  <span className="hint">{k === "maxLtvBps" ? "operator may borrow up to here" : k === "triggerLtvBps" ? `must be below the market's ${market ? (market.lltv * 100).toFixed(0) + "%" : "LLTV"}` : k === "repayBps" ? "of the debt, per protection" : "vs the Morpho oracle"}</span>
                </div>
              ))}
            </div>
            {policyProblem && <p className="note bad" style={{ marginTop: 10 }}>{policyProblem[0].toUpperCase() + policyProblem.slice(1)}.</p>}
            {custom && <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>Custom policy. <button className="btn xs" onClick={() => { setCustom(false); setPolicy({ ...PRESETS[preset] }); }}>Back to {PRESETS[preset].label}</button></p>}
            {market && market.collateralPrice && <p className="note" style={{ marginTop: 10 }}>At today's oracle price of {usd(market.collateralPrice, 2)} per {group?.collateral.symbol}, 10 tokens let the agent borrow up to {usd(10 * market.collateralPrice * policy.maxLtvBps / 10_000)} USDG; protection starts if the price falls to {usd(10 * market.collateralPrice * policy.maxLtvBps / policy.triggerLtvBps / 10, 2)} (from a full borrow); Morpho liquidates at {usd(10 * market.collateralPrice * policy.maxLtvBps / (market.lltv * 10_000) / 10, 2)}.</p>}
          </div>
        </div>

        <div className="step">
          <div>
            <h3>The operator key</h3>
            <p>The key the agent runner signs with. Generated here, shown once, never sent anywhere. It can act inside the policy; it cannot withdraw.</p>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="seg"><button className={opMode === "generate" ? "on" : ""} onClick={() => setOpMode("generate")}>Generate in browser</button><button className={opMode === "paste" ? "on" : ""} onClick={() => setOpMode("paste")}>Paste an address</button></div>
            </div>
            {opMode === "generate" ? (
              <div style={{ marginTop: 12 }}>
                {!generated ? <button className="btn sm" onClick={generate}>Generate operator key</button> : (
                  <div className="panel">
                    <div className="kv"><span>Operator address</span><b style={{ wordBreak: "break-all" }}>{generated.address} <button className="btn xs" onClick={() => copy("address", generated.address)}>{copied === "address" ? "copied" : "copy"}</button></b></div>
                    <div className="kv"><span>Private key</span>
                      <b style={{ wordBreak: "break-all" }}>
                        {!generated.privateKey ? <span className="faint">cleared: the vault is created, the key lives only where you saved it</span>
                          : revealed ? <>{generated.privateKey} <button className="btn xs" onClick={() => copy("key", generated.privateKey)}>{copied === "key" ? "copied" : "copy"}</button> <button className="btn xs" onClick={() => setRevealed(false)}>hide</button></>
                          : <><span className="faint">••••••••••••••••••••••••••••••••</span> <button className="btn xs" onClick={() => setRevealed(true)}>reveal</button> <button className="btn xs" onClick={() => copy("key", generated.privateKey)}>{copied === "key" ? "copied" : "copy without showing"}</button></>}
                      </b>
                    </div>
                    <p className="lbl" style={{ marginTop: 12 }}>Put it in the runner as AGENT_PRIVATE_KEY. Fund the address with a little ETH for gas. It is generated in this tab and never sent anywhere; it is erased from the page once the vault is created.</p>
                    <label className="row" style={{ marginTop: 12, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} disabled={!generated.privateKey} /> I have saved the private key somewhere safe.</label>
                  </div>
                )}
              </div>
            ) : (
              <div className="field" style={{ marginTop: 12 }}><label>Operator address</label><input placeholder="0x…" value={pasted} onChange={(e) => setPasted(e.target.value.trim())} />{pasted && !ethers.isAddress(pasted) && <span className="hint red">not an address</span>}</div>
            )}
          </div>
        </div>

        <div className="step">
          <div>
            <h3>Create the vault</h3>
            <p>One signature. Then fund the vault with collateral and borrow from its page; the runner does the rest.</p>
            {market && group && operator && (
              <div className="card soft" style={{ marginTop: 12 }}>
                <div className="kv"><span>Pair</span><b><Tok symbol={group.collateral.symbol} /> / USDG</b></div>
                <div className="kv"><span>Market</span><b>{market.id.slice(0, 10)}… · LLTV {(market.lltv * 100).toFixed(0)}% · {pct(market.borrowApy)}</b></div>
                <div className="kv"><span>Policy</span><b>ceiling {policy.maxLtvBps / 100}% · trigger {policy.triggerLtvBps / 100}% · repay {policy.repayBps / 100}% · slippage {policy.maxSlippageBps / 100}%</b></div>
                <div className="kv"><span>Operator</span><b>{operator}</b></div>
              </div>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={!ready || tx.busy} onClick={create}>{tx.busy ? tx.step : vault ? "Vault created" : "Create vault"}</button>
              {tx.hash && <TxLink hash={tx.hash}>transaction ↗</TxLink>}
            </div>
            {tx.error && <p className="note bad" style={{ marginTop: 10 }}>{tx.error}</p>}
            {vault && <p className="note good" style={{ marginTop: 10 }}>Vault created: <Link href={`/vault/${vault}`} className="mono" style={{ textDecoration: "underline" }}>{vault}</Link>. Next: deposit collateral and borrow there.</p>}
            {tx.hash && !vault && <p className="note" style={{ marginTop: 10 }}>Confirmed or confirming — your new vault appears on the <Link href="/app" style={{ textDecoration: "underline" }}>dashboard</Link>.</p>}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Deploy() {
  return (
    <>
      <Nav />
      <Suspense fallback={<main className="wrap" style={{ padding: 48 }}>Loading…</main>}>
        <DeployInner />
      </Suspense>
    </>
  );
}
