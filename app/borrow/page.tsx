"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import Nav from "../components/Nav";
import { useLive } from "../components/useLive";
import { useWallet } from "../components/WalletProvider";
import { useTx } from "../components/useTx";
import { TokenLogo, TxLink, pct } from "../components/ui";
import { usd } from "../components/format";
import { CHAIN_NAME, FACTORY, HOSTED_OPERATOR } from "../components/brand";
import HostedStatus from "../components/HostedStatus";
import FactoryAbi from "@/lib/abis/PayoffVaultFactory.json";
import FundLoan from "../components/FundLoan";

/**
 * Deploy an agent, one step at a time. Each step asks one question in plain words,
 * picks a sensible answer by default, and hides the knobs behind "fine-tune". Earlier
 * steps collapse into a one-line summary with a "change" link, so the page never shows
 * more than one decision at once.
 *
 *   1. connect the wallet that will OWN the vault
 *   2. choose the stock to borrow against (the best Morpho market is picked for you)
 *   3. choose how careful the agent should be (three presets; fine-tune if you like)
 *   4. create the agent's key in this browser (it can work, it cannot withdraw)
 *   5. sign once; then deposit, borrow, and start the runner
 */

type Row = { id: string; lltv: number; listed: boolean; borrowApy: number | null; utilization: number; liquidityUsd: number; totalSupplyUsd: number; collateralPrice: number | null; oracleSuspect?: boolean };
type Group = { collateral: { address: string; symbol: string; isStock: boolean; name: string | null }; best: Row | null; rows: Row[] };
type Board = { live: boolean; groups: Group[] };

const PRESETS = {
  careful: { label: "Careful", maxLtvBps: 3500, triggerLtvBps: 5000, repayBps: 3000, maxSlippageBps: 100, blurb: "Borrows little, protects early. Sleeps well through a bad week.", needsLltv: 0.5 },
  balanced: { label: "Balanced", maxLtvBps: 4500, triggerLtvBps: 5500, repayBps: 2500, maxSlippageBps: 100, blurb: "The default. Room to earn, a wide cushion before anything happens.", needsLltv: 0.55 },
  bold: { label: "Bold", maxLtvBps: 5500, triggerLtvBps: 6000, repayBps: 2500, maxSlippageBps: 150, blurb: "Borrows more, protects later. For markets with a high liquidation line.", needsLltv: 0.6 },
};
type PresetKey = keyof typeof PRESETS;

const STEPS = ["Connect", "Choose a stock", "Choose safety", "Auto-repay", "Open"];

function DeployInner() {
  const params = useSearchParams();
  const w = useWallet();
  const tx = useTx();
  const board = useLive<Board>("/api/markets", { live: false, groups: [] });

  const [step, setStep] = useState(0);
  const [stocksOnly, setStocksOnly] = useState(true);
  const [q, setQ] = useState("");
  const [collateral, setCollateral] = useState<string>("");
  const [marketId, setMarketId] = useState<string>(params.get("market") ?? "");
  const [advancedMarket, setAdvancedMarket] = useState(false);
  const [preset, setPreset] = useState<PresetKey>("balanced");
  const [policy, setPolicy] = useState({ maxLtvBps: PRESETS.balanced.maxLtvBps, triggerLtvBps: PRESETS.balanced.triggerLtvBps, repayBps: PRESETS.balanced.repayBps, maxSlippageBps: PRESETS.balanced.maxSlippageBps });
  const [custom, setCustom] = useState(false);
  const [fineTune, setFineTune] = useState(false);
  const [opMode, setOpMode] = useState<"hosted" | "generate" | "paste">(HOSTED_OPERATOR ? "hosted" : "generate");
  const [generated, setGenerated] = useState<{ address: string; privateKey: string } | null>(null);
  const [pasted, setPasted] = useState("");
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [vault, setVault] = useState<string | null>(null);

  const allGroups = board.data?.groups ?? [];
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allGroups
      .filter((g) => g.best && (!stocksOnly || g.collateral.isStock))
      .filter((g) => !needle || g.collateral.symbol.toLowerCase().includes(needle) || (g.collateral.name ?? "").toLowerCase().includes(needle));
  }, [allGroups, stocksOnly, q]);
  const group = allGroups.find((g) => g.collateral.address.toLowerCase() === collateral.toLowerCase()) ?? allGroups.find((g) => g.rows.some((r) => r.id === marketId));
  const market = group?.rows.find((r) => r.id === marketId) ?? null;

  // ?market= from the landing grid: preselect, and skip straight past the stock step once connected.
  useEffect(() => {
    if (marketId && !collateral && board.data) {
      const g = board.data.groups.find((x) => x.rows.some((r) => r.id === marketId));
      if (g) setCollateral(g.collateral.address);
    }
  }, [marketId, collateral, board.data]);
  useEffect(() => { if (step === 0 && w.address && !w.wrongChain) setStep(marketId && market ? 2 : 1); }, [w.address, w.wrongChain, step, marketId, market]);
  useEffect(() => { if (!custom) { const p = PRESETS[preset]; setPolicy({ maxLtvBps: p.maxLtvBps, triggerLtvBps: p.triggerLtvBps, repayBps: p.repayBps, maxSlippageBps: p.maxSlippageBps }); } }, [preset, custom]);
  function editPolicy(k: keyof typeof policy, v: number) { setCustom(true); setPolicy({ ...policy, [k]: v }); }

  const operator = opMode === "hosted" ? HOSTED_OPERATOR : opMode === "generate" ? generated?.address ?? "" : ethers.isAddress(pasted) ? ethers.getAddress(pasted) : "";
  const lltvOk = market ? policy.triggerLtvBps < market.lltv * 10_000 : true;
  const policyProblem = (() => {
    const p = policy;
    for (const k of ["maxLtvBps", "triggerLtvBps", "repayBps", "maxSlippageBps"] as const) if (!Number.isFinite(p[k]) || p[k] < 0) return "every field needs a number";
    if (p.maxLtvBps > 9500) return "the borrow ceiling cannot exceed 95%";
    if (p.triggerLtvBps < p.maxLtvBps) return "the protection trigger must be at or above the borrow ceiling";
    if (p.triggerLtvBps > 10_000) return "the trigger cannot exceed 100%";
    if (!lltvOk) return `the trigger must sit below this market's liquidation line (${((market?.lltv ?? 0) * 100).toFixed(0)}%); otherwise Morpho liquidates before the agent can act`;
    if (p.repayBps <= 0 || p.repayBps > 10_000) return "the repay share must be between 0.01% and 100%";
    if (p.maxSlippageBps < 10) return "slippage must be at least 0.1%, or no swap could ever clear the pool fee";
    if (p.maxSlippageBps > 2000) return "slippage cannot exceed 20%";
    return null;
  })();
  const stepDone = [
    !!w.address && !w.wrongChain,
    !!market,
    !!market && !policyProblem,
    !!operator && (opMode !== "generate" || saved),
    !!vault,
  ];
  const ready = stepDone[0] && stepDone[1] && stepDone[2] && stepDone[3] && !!FACTORY && !vault;

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

  // Plain-language example for the safety step, from live prices.
  const px = market?.collateralPrice ?? null;
  const sym = group?.collateral.symbol ?? "the stock";
  const example = px && market ? {
    borrow: 10 * px * policy.maxLtvBps / 10_000,
    protectAt: px * policy.maxLtvBps / policy.triggerLtvBps,
    liqAt: px * policy.maxLtvBps / (market.lltv * 10_000),
  } : null;

  const Summary = ({ i, text }: { i: number; text: React.ReactNode }) => (
    <div className="wz-done">
      <span className="wz-num done">✓</span>
      <span className="wz-title">{STEPS[i]}</span>
      <span className="wz-sum">{text}</span>
      {!vault && <button className="btn xs" onClick={() => setStep(i)}>change</button>}
    </div>
  );

  return (
    <main className="wrap" style={{ padding: "40px 24px 80px", maxWidth: 820 }}>
      <span className="eyebrow">Open a loan</span>
      <h2>Five short steps. One signature at the end.</h2>
      <p className="lede">Borrow USDG against a stock you hold, and let the loan pay itself down. Only your wallet can take money out; auto-repay can only work inside the limits you set here.</p>
      {!FACTORY && <p className="note warn" style={{ marginTop: 18 }}>The vault factory is not deployed on this site yet. You can walk through the steps; the final signature is disabled.</p>}

      <ol className="wz-bar" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "cur" : stepDone[i] ? "done" : ""}><span>{stepDone[i] && i !== step ? "✓" : i + 1}</span>{s}</li>)}
      </ol>

      <div className="wz">
        {/* 1. connect */}
        {step > 0 && stepDone[0] ? <Summary i={0} text={<span className="mono">{w.address!.slice(0, 6)}…{w.address!.slice(-4)}</span>} /> : (
          <div className="wz-step">
            <span className="wz-num">1</span>
            <div>
              <h3>Connect the wallet that will own the vault</h3>
              <p>This is the only address the vault will ever pay out to. Use a wallet you control, on {CHAIN_NAME}.</p>
              <div className="row" style={{ marginTop: 14 }}>
                {!w.address && <button className="btn green" onClick={w.connect} disabled={w.connecting}>{w.connecting ? "Connecting…" : "Connect wallet"}</button>}
                {w.address && w.wrongChain && <button className="btn coral" onClick={w.switchChain}>Switch to {CHAIN_NAME}</button>}
                {w.address && !w.wrongChain && <span className="pill g">{w.address}</span>}
              </div>
              {w.error && <p className="note bad" style={{ marginTop: 10 }}>{w.error}</p>}
            </div>
          </div>
        )}

        {/* 2. stock */}
        {step > 1 && stepDone[1] ? <Summary i={1} text={<span className="row" style={{ gap: 8 }}><TokenLogo symbol={sym} size={18} /> {sym} · best market at {pct(market!.borrowApy)} · liquidation line {(market!.lltv * 100).toFixed(0)}%</span>} /> : step >= 1 && (
          <div className="wz-step">
            <span className="wz-num">2</span>
            <div>
              <h3>Choose the stock to borrow against</h3>
              <p>You deposit this token as collateral and borrow USDG against it. The cheapest Morpho market with real liquidity is picked for you.</p>
              <div className="mk-head" style={{ marginTop: 14 }}>
                <label className="mk-search"><input placeholder="Search a ticker…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /><kbd>{groups.length}</kbd></label>
                <div className="seg"><button className={stocksOnly ? "on" : ""} onClick={() => setStocksOnly(true)}>Stocks</button><button className={!stocksOnly ? "on" : ""} onClick={() => setStocksOnly(false)}>All collateral</button></div>
              </div>
              <div className="wz-stocks">
                {groups.slice(0, q ? 40 : 12).map((g) => {
                  const on = g.collateral.address.toLowerCase() === collateral.toLowerCase();
                  return (
                    <button key={g.collateral.address} className={"wz-stock" + (on ? " on" : "")} onClick={() => { setCollateral(g.collateral.address); setMarketId(g.best!.id); setAdvancedMarket(false); }}>
                      <span className="logo"><TokenLogo symbol={g.collateral.symbol} size={36} /></span>
                      <span className="id"><b>{g.collateral.symbol}</b><small>{g.collateral.name ?? (g.collateral.isStock ? "Stock Token" : "collateral")}</small></span>
                      <span className="rate">{pct(g.best!.borrowApy)}<small>{usd(g.best!.liquidityUsd)} available</small></span>
                    </button>
                  );
                })}
                {groups.length === 0 && <div className="mk-empty">{board.loading ? "Reading markets…" : q ? `Nothing matches "${q}".` : "No markets with liquidity right now."}</div>}
              </div>
              {market && (
                <div className="note" style={{ marginTop: 12 }}>
                  <b>{sym}</b>: borrow at <b className="green">{pct(market.borrowApy)}</b> a year, {usd(market.liquidityUsd)} USDG available, Morpho liquidates above {(market.lltv * 100).toFixed(0)}% loan-to-value.
                  {market.liquidityUsd < 100 && <> <span className="amber">Almost nothing to lend right now; you can create the vault and borrow once someone supplies.</span></>}
                  <div style={{ marginTop: 8 }}><button className="btn xs" onClick={() => setAdvancedMarket((a) => !a)}>{advancedMarket ? "Hide" : "Choose a different market of this pair"}</button></div>
                </div>
              )}
              {advancedMarket && group && (
                <div className="tblwrap" style={{ marginTop: 10 }}>
                  <table className="tbl" style={{ fontSize: 12 }}>
                    <thead><tr><th></th><th>Market</th><th className="r">Liq. line</th><th className="r">Borrow APY</th><th className="r">Available</th></tr></thead>
                    <tbody>
                      {group.rows.map((r) => (
                        <tr key={r.id} onClick={() => setMarketId(r.id)} style={{ cursor: "pointer" }}>
                          <td><input type="radio" name="market" checked={marketId === r.id} onChange={() => setMarketId(r.id)} aria-label={`market ${r.id.slice(0, 10)}`} /></td>
                          <td className="mono">{r.id.slice(0, 10)}… {group.best?.id === r.id && <span className="pill g">best</span>}</td>
                          <td className="r">{(r.lltv * 100).toFixed(1)}%</td>
                          <td className="r">{pct(r.borrowApy)}</td>
                          <td className="r">{usd(r.liquidityUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row" style={{ marginTop: 16 }}><button className="btn green" disabled={!stepDone[1]} onClick={() => setStep(2)}>Continue<span className="arr">→</span></button></div>
            </div>
          </div>
        )}

        {/* 3. safety */}
        {step > 2 && stepDone[2] ? <Summary i={2} text={<>{custom ? "Custom" : PRESETS[preset].label}: borrow up to {policy.maxLtvBps / 100}%, protect at {policy.triggerLtvBps / 100}%</>} /> : step >= 2 && (
          <div className="wz-step">
            <span className="wz-num">3</span>
            <div>
              <h3>How careful should the loan be?</h3>
              <p>Two numbers matter: how much can be borrowed against your collateral, and the price line where the loan starts repaying itself to stay away from liquidation. The vault enforces both.</p>
              <div className="wz-presets">
                {(Object.keys(PRESETS) as PresetKey[]).map((k) => {
                  const p = PRESETS[k];
                  const fits = !market || p.triggerLtvBps < market.lltv * 10_000;
                  return (
                    <button key={k} className={"wz-preset" + (preset === k && !custom ? " on" : "") + (fits ? "" : " off")} disabled={!fits} onClick={() => { setPreset(k); setCustom(false); }}>
                      <b>{p.label}</b>
                      <span className="nums"><span>borrow to <b>{p.maxLtvBps / 100}%</b></span><span>protect at <b>{p.triggerLtvBps / 100}%</b></span></span>
                      <small>{fits ? p.blurb : `Needs a liquidation line above ${p.triggerLtvBps / 100}%; this market's is ${((market?.lltv ?? 0) * 100).toFixed(0)}%.`}</small>
                    </button>
                  );
                })}
              </div>
              {example && (
                <div className="note good" style={{ marginTop: 14 }}>
                  With <b>10 {sym}</b> at today's price of {usd(px!, 2)}: you can borrow up to <b>{usd(example.borrow)} USDG</b>. If {sym} falls to <b>{usd(example.protectAt, 2)}</b> the loan starts repaying itself. Morpho would only liquidate at <b>{usd(example.liqAt, 2)}</b>.
                </div>
              )}
              <div style={{ marginTop: 12 }}><button className="btn xs" onClick={() => setFineTune((f) => !f)}>{fineTune ? "Hide fine-tuning" : "Fine-tune the numbers"}</button></div>
              {fineTune && (
                <div className="grid g4" style={{ marginTop: 12, gap: 12 }}>
                  {([["maxLtvBps", "Borrow ceiling", "of collateral value"], ["triggerLtvBps", "Protect at", `below the ${market ? (market.lltv * 100).toFixed(0) + "%" : ""} liquidation line`], ["repayBps", "Repay share", "of the debt, per protection"], ["maxSlippageBps", "Max slippage", "on every swap, vs the oracle"]] as const).map(([k, label, hint]) => (
                    <div className="field" key={k} style={{ marginBottom: 0 }}>
                      <label>{label} (%)</label>
                      <input type="number" value={Number.isFinite(policy[k]) ? (policy[k] / 100).toString() : ""} min={0} max={100} step={k === "maxSlippageBps" ? 0.1 : 0.5} onChange={(e) => editPolicy(k, e.target.value === "" ? NaN : Math.round(Number(e.target.value) * 100))} />
                      <span className="hint">{hint}</span>
                    </div>
                  ))}
                </div>
              )}
              {policyProblem && <p className="note bad" style={{ marginTop: 10 }}>{policyProblem[0].toUpperCase() + policyProblem.slice(1)}.</p>}
              {custom && <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>Custom numbers. <button className="btn xs" onClick={() => setCustom(false)}>Back to {PRESETS[preset].label}</button></p>}
              <div className="row" style={{ marginTop: 16 }}><button className="btn green" disabled={!stepDone[2]} onClick={() => setStep(3)}>Continue<span className="arr">→</span></button><button className="btn" onClick={() => setStep(1)}>Back</button></div>
            </div>
          </div>
        )}

        {/* 4. agent key */}
        {step > 3 && stepDone[3] ? <Summary i={3} text={opMode === "hosted" ? <>by PAYOFF <span className="mono faint">{operator.slice(0, 6)}…{operator.slice(-4)}</span></> : <span className="mono">{operator.slice(0, 6)}…{operator.slice(-4)}</span>} /> : step >= 3 && (
          <div className="wz-step">
            <span className="wz-num">4</span>
            <div>
              <h3>Who runs auto-repay?</h3>
              {opMode === "hosted" ? (
                <div className="hosted">
                  <div className="hosted-head"><b>PAYOFF runs it for you</b><span className="pill a">recommended</span></div>
                  <p>Our program checks your loan every minute, around the clock: puts the USDG into the pool, collects the fees, pays them onto the loan, and moves the loan if a cheaper market shows up.</p>
                  <ul className="wz-list">
                    <li>Its key can only <b>work</b> the loan. It cannot send anything out of your vault. Only your wallet can.</li>
                    <li>You can switch it off, or swap in your own key, any time on the vault page.</li>
                    <li>Nothing to install, no key to save.</li>
                  </ul>
                  <HostedStatus />
                  <button className="btn xs" style={{ marginTop: 10 }} onClick={() => setOpMode("generate")}>I'd rather run it myself</button>
                </div>
              ) : opMode === "generate" ? (
                !generated ? (
                  <div className="row" style={{ marginTop: 14 }}>
                    <button className="btn green" onClick={generate}>Create the auto-repay key</button>
                    <button className="btn xs" onClick={() => setOpMode("paste")}>I already have an auto-repay address</button>
                    {HOSTED_OPERATOR && <button className="btn xs" onClick={() => setOpMode("hosted")}>Let PAYOFF run it</button>}
                  </div>
                ) : (
                  <div className="panel" style={{ marginTop: 14 }}>
                    <div className="kv"><span>Auto-repay address</span><b style={{ wordBreak: "break-all" }}>{generated.address} <button className="btn xs" onClick={() => copy("address", generated.address)}>{copied === "address" ? "copied" : "copy"}</button></b></div>
                    <div className="kv"><span>Private key</span>
                      <b style={{ wordBreak: "break-all" }}>
                        {!generated.privateKey ? <span className="faint">cleared: the vault is created, the key lives only where you saved it</span>
                          : revealed ? <>{generated.privateKey} <button className="btn xs" onClick={() => copy("key", generated.privateKey)}>{copied === "key" ? "copied" : "copy"}</button> <button className="btn xs" onClick={() => setRevealed(false)}>hide</button></>
                          : <><span className="faint">••••••••••••••••••••••••••••••••</span> <button className="btn xs" onClick={() => setRevealed(true)}>reveal</button> <button className="btn xs" onClick={() => copy("key", generated.privateKey)}>{copied === "key" ? "copied" : "copy without showing"}</button></>}
                      </b>
                    </div>
                    <ol className="wz-list">
                      <li>Copy the private key and keep it somewhere safe. It is shown only now.</li>
                      <li>Later, give it to the auto-repay program as <code className="inline">AGENT_PRIVATE_KEY</code> and send the address a little ETH for gas (0.005 is months).</li>
                    </ol>
                    <label className="row" style={{ marginTop: 12, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} disabled={!generated.privateKey} /> I saved the private key.</label>
                  </div>
                )
              ) : (
                <div style={{ marginTop: 14 }}>
                  <div className="field"><label>Auto-repay address</label><input placeholder="0x…" value={pasted} onChange={(e) => setPasted(e.target.value.trim())} />{pasted && !ethers.isAddress(pasted) && <span className="hint red">not an address</span>}</div>
                  <button className="btn xs" onClick={() => setOpMode("generate")}>Create a new key instead</button>
                </div>
              )}
              <div className="row" style={{ marginTop: 16 }}><button className="btn green" disabled={!stepDone[3]} onClick={() => setStep(4)}>Continue<span className="arr">→</span></button><button className="btn" onClick={() => setStep(2)}>Back</button></div>
            </div>
          </div>
        )}

        {/* 5. create */}
        {step >= 4 && (
          <div className="wz-step">
            <span className={"wz-num" + (vault ? " done" : "")}>{vault ? "✓" : 5}</span>
            <div>
              <h3>{vault ? "Your loan is open" : "Open the loan"}</h3>
              {!vault && <p>One signature from your wallet. Your loan lives in a small contract only you own, with the limits above written into it.</p>}
              {!vault && market && group && operator && (
                <div className="card soft" style={{ marginTop: 12 }}>
                  <div className="kv"><span>Collateral</span><b className="row" style={{ gap: 8 }}><TokenLogo symbol={sym} size={18} /> {sym} → borrow USDG at {pct(market.borrowApy)}</b></div>
                  <div className="kv"><span>Safety</span><b>borrow up to {policy.maxLtvBps / 100}% · protect at {policy.triggerLtvBps / 100}% · liquidation line {(market.lltv * 100).toFixed(0)}%</b></div>
                  <div className="kv"><span>Auto-repay</span><b className="mono">{opMode === "hosted" ? "by PAYOFF · " : ""}{operator}</b></div>
                  <div className="kv"><span>Fees</span><b>0% to borrow · 2.5% of harvested fees · 10% of realised profit</b></div>
                </div>
              )}
              {!vault && (
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn green lg" disabled={!ready || tx.busy} onClick={create}>{tx.busy ? tx.step : "Open the loan"}</button>
                  <button className="btn" onClick={() => setStep(3)} disabled={tx.busy}>Back</button>
                  {tx.hash && <TxLink hash={tx.hash}>transaction ↗</TxLink>}
                </div>
              )}
              {tx.error && <p className="note bad" style={{ marginTop: 10 }}>{tx.error}</p>}
              {tx.hash && !vault && !tx.busy && <p className="note" style={{ marginTop: 10 }}>Confirming… your vault will appear on the <Link href="/app" style={{ textDecoration: "underline" }}>dashboard</Link>.</p>}
              {vault && (
                <div style={{ marginTop: 12 }}>
                  <p className="note good">Vault <Link href={`/vault/${vault}`} className="mono" style={{ textDecoration: "underline" }}>{vault}</Link> is yours. Now fund it, right here:</p>
                  {group && <FundLoan vault={vault} symbol={sym} token={group.collateral.address} price={px} maxLtvBps={policy.maxLtvBps} />}
                  {opMode === "hosted" && <p className="note good" style={{ marginTop: 14 }}>Auto-repay by PAYOFF is watching this vault from now on. It checks every minute; the vault page shows each step it takes.</p>}
                  {opMode !== "hosted" && <details className="wz-more" style={{ marginTop: 16 }}>
                    <summary>Running auto-repay yourself</summary>
                    <p style={{ marginTop: 8 }}>Auto-repay is a small program. Run it on any machine that stays on, with the key you saved:</p>
                    <pre className="code" style={{ marginTop: 8 }}>{`PAYOFF_API_URL=${typeof window !== "undefined" ? window.location.origin : "https://payoff-pi.vercel.app"}
PAYOFF_FACTORY_ADDRESS=${FACTORY}
AGENT_VAULTS=${vault}
AGENT_PRIVATE_KEY=<the key you saved>
AGENT_DRY_RUN=true   # watch /decisions first, then set false
npm run agent`}</pre>
                    <Link href="/docs#runner" style={{ textDecoration: "underline", fontSize: 13 }}>Full setup guide</Link>
                  </details>}
                </div>
              )}
            </div>
          </div>
        )}
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
