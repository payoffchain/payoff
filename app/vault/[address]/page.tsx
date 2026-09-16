"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Nav from "../../components/Nav";
import { useWallet } from "../../components/WalletProvider";
import { useTx } from "../../components/useTx";
import { AddrLink, DataBanner, Empty, Gauge, LtvBar, Stat, TokenLogo, TxLink, bps, pct } from "../../components/ui";
import { usd, ago, amount, EXPLORER } from "../../components/format";
import VaultLog from "../../components/VaultLog";
import { HOSTED_OPERATOR } from "../../components/brand";

/** The next auto-repay step, in plain words, for the live log. */
const NEXT_WORDS: Record<string, string> = {
  protect: "sell a little collateral and pay the loan down (protection)",
  refinance: "move the loan to a cheaper market",
  harvest: "collect the pool fees and pay them onto the loan",
  close: "close a pool position and pay the loan down",
  open: "put the idle USDC into the pool",
};

type Lp = { tokenId: string; fee: number; tickLower: number; tickUpper: number; inRange: boolean; priceLower: number | null; priceUpper: number | null; currentPrice: number | null; amountCollateral: number; amountLoan: number; valueUsd: number | null; uncollected: { collateral: number; loan: number; usd: number | null } | null; costBasis: number };
type Vault = {
  address: string; owner: string; operator: string; pendingOwner: string; paused: boolean; createdAt: number;
  collateral: { address: string; symbol: string; decimals: number }; loan: { address: string; symbol: string; decimals: number };
  market: { id: string; lltv: number; borrowApy: number | null; known: boolean };
  policy: { maxLtvBps: number; triggerLtvBps: number; repayBps: number; maxSlippageBps: number };
  position: { collateral: number; collateralUsd: number | null; debt: number; ltvBps: number | null; ltv: number | null; healthFactor: number | null; liquidationPrice: number | null; collateralPrice: number | null };
  balances: { loan: number; collateral: number };
  stats: { totalBorrowed: number; totalRepaid: number; totalRepaidFromFees: number; totalHarvested: number; totalProtocolFees: number; refinanceCount: number };
  lp: Lp[]; lpValueUsd: number | null; netValueUsd: number | null; allowedMarkets: string[];
};
type PlanAction = { kind: string; reason: string; valueUsd: number | null; args: { tokenId?: string; marketId?: string; fee?: number }; built: { tx: { description: string }; notes?: string[] } };
type Plan = { at: string; actions: PlanAction[]; skipped: Array<{ rule: string; why: string }>; settings: Record<string, unknown> };
type Activity = { entries: Array<{ block: number; time: number | null; tx: string; type: string; title: string; detail: string }>; partial?: boolean; fromBlock?: number };
type Target = { id: string; lltv: number; borrowApy: number | null; liquidity: string; listed: boolean };

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j as T;
}

export default function VaultPage() {
  const { address } = useParams<{ address: string }>();
  const w = useWallet();
  const tx = useTx();
  const [v, setV] = useState<Vault | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [act, setAct] = useState<Activity | null>(null);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [tab, setTab] = useState<"position" | "agent" | "activity" | "settings">("position");
  const [panelErr, setPanelErr] = useState<{ plan?: string; activity?: string; targets?: string }>({});
  const [tick, setTick] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let dead = false;
    setErr(null);
    setPanelErr({});
    get<Vault>(`/api/vaults/${address}`).then((d) => { if (!dead) setV(d); }).catch((e) => { if (!dead) setErr(e.message); });
    get<Plan>(`/api/vaults/${address}/plan`).then((d) => { if (!dead) setPlan(d); }).catch((e) => { if (!dead) setPanelErr((x) => ({ ...x, plan: e.message })); });
    get<Activity>(`/api/vaults/${address}/activity?limit=100`).then((d) => { if (!dead) { setAct(d); setRefreshedAt(Date.now()); } }).catch((e) => { if (!dead) setPanelErr((x) => ({ ...x, activity: e.message })); });
    get<{ targets: Target[] }>(`/api/vaults/${address}/targets`).then((d) => { if (!dead) setTargets(d.targets); }).catch((e) => { if (!dead) setPanelErr((x) => ({ ...x, targets: e.message })); });
    return () => { dead = true; };
  }, [address, tick]);

  // Refresh while the page is open: LTV and "agent on" go stale otherwise. Paused when
  // the tab is hidden, and never while a transaction is being signed.
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden && !tx.busy) refresh(); }, 45_000);
    return () => clearInterval(id);
  }, [refresh, tx.busy]);

  const isOwner = !!w.address && !!v && w.address.toLowerCase() === v.owner.toLowerCase();
  const isOperator = !!w.address && !!v && w.address.toLowerCase() === v.operator.toLowerCase();
  // The contract refuses the operator while paused; do not offer buttons that revert.
  const can = isOwner || (isOperator && !!v && !v.paused);

  async function send(body: unknown) {
    // run() resolves once the receipt is in (or null on rejection / revert), so a refresh
    // here shows the new state, not the old one under a green "sent".
    const hash = await tx.run(`/api/vaults/${address}/tx`, body);
    if (hash) refresh();
  }

  if (err) return (<><Nav /><main className="wrap" style={{ padding: 48 }}><Empty>{err}</Empty></main></>);
  if (!v) return (<><Nav /><main className="wrap" style={{ padding: 48 }}><p className="skeleton">loading vault</p></main></>);

  const p = v.position;
  const maxBorrow = p.collateralUsd === null ? null : p.collateralUsd * v.policy.maxLtvBps / 10_000 - p.debt;

  // The one thing to do next, in plain words. Owners get a button that opens the
  // right form; everyone else just reads the state.
  const jump = (id: string) => { setTab("position"); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); };
  const next = (() => {
    const sym = v.collateral.symbol;
    if (p.collateral === 0 && v.balances.collateral === 0) return { n: "1 of 3", t: `Put your ${sym} in`, d: `Nothing is in the vault yet. Deposit ${sym} and it goes into Morpho under your vault's name; only your wallet can take it back out.`, cta: isOwner ? { label: `Deposit ${sym}`, go: () => jump("f-deposit") } : null };
    if (p.debt === 0) return { n: "2 of 3", t: "Borrow USDC against it", d: `${amount(p.collateral)} ${sym} is in. You can borrow up to ${maxBorrow === null ? "your ceiling" : usd(Math.max(0, maxBorrow), 2)}; a little under it leaves room for a bad day.`, cta: can ? { label: "Borrow USDC", go: () => jump("f-borrow") } : null };
    if (v.paused) return { n: "3 of 3", t: "Auto-repay is off", d: "The loan is open but nothing is working on it. Turn auto-repay on and the USDC goes into the pool, fees get collected, and the debt starts going down.", cta: isOwner ? { label: "Turn auto-repay on", go: () => send({ action: "setPaused", paused: false }) } : null };
    if (v.lp.length === 0 && v.balances.loan > 0) return { n: "3 of 3", t: "USDC is waiting to be put to work", d: `${amount(v.balances.loan, 2)} USDC sits in the vault. Auto-repay puts it into the ${sym}/USDC pool on its next run; nothing for you to do.`, cta: null };
    if (v.lp.length > 0) return { n: "earning", t: "Your loan is paying itself down", d: `${v.lp.length} pool position${v.lp.length === 1 ? "" : "s"} open. Every swap in the pool pays a fee; each collection lands on the loan. Repaid so far: ${usd(v.stats.totalRepaidFromFees, 2)}.`, cta: null };
    return null;
  })();

  return (
    <>
      <Nav />
      <DataBanner live={true} loading={false} error={null} what="" />
      <main className="wrap" style={{ padding: "40px 24px 80px" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <span className="eyebrow">Vault · <span style={{ textTransform: "none", letterSpacing: 0 }}><AddrLink address={v.address} /></span></span>
            <h2 style={{ display: "flex", alignItems: "center", gap: 14 }}><TokenLogo symbol={v.collateral.symbol} size={30} /> {v.collateral.symbol} / {v.loan.symbol}</h2>
            <div className="row faint mono" style={{ fontSize: 12, marginTop: 8 }}>
              <span>owner <AddrLink address={v.owner} /></span><span>auto-repay {v.operator === "0x0000000000000000000000000000000000000000" ? "none" : HOSTED_OPERATOR && v.operator.toLowerCase() === HOSTED_OPERATOR.toLowerCase() ? <><span className="pill a">by PAYOFF</span> <AddrLink address={v.operator} /></> : <>key <AddrLink address={v.operator} /></>}</span><span>created {ago(v.createdAt)}</span>
              {v.paused ? <span className="pill a">auto-repay off</span> : <span className="pill g">auto-repay on</span>}
              {isOwner && <span className="pill g">you own this</span>}{isOperator && <span className="pill">you run auto-repay here</span>}
            </div>
          </div>
          <div className="row">
            {isOwner && <button className="btn sm" onClick={() => send({ action: "setPaused", paused: !v.paused })} disabled={tx.busy}>{v.paused ? "Turn auto-repay on" : "Turn auto-repay off"}</button>}
            <button className="btn sm" onClick={refresh}>Refresh</button>
          </div>
        </div>

        {next && (
          <div className="nextcard" style={{ marginTop: 24 }}>
            <span className="nc-step">{next.n}</span>
            <div><b>{next.t}</b><p>{next.d}</p></div>
            {next.cta && <button className="btn green" disabled={tx.busy} onClick={next.cta.go}>{next.cta.label}<span className="arr">→</span></button>}
          </div>
        )}

        <div className="stats" style={{ marginTop: 28 }}>
          <Stat label="Collateral" value={usd(p.collateralUsd)} sub={`${amount(p.collateral)} ${v.collateral.symbol} @ ${p.collateralPrice ? usd(p.collateralPrice, 2) : "—"}`} />
          <Stat label="Debt" value={usd(p.debt, 2)} sub={`borrowing at ${pct(v.market.borrowApy)} · LLTV ${(v.market.lltv * 100).toFixed(0)}%`} />
          <Stat label="Repaid from fees" value={usd(v.stats.totalRepaidFromFees, 2)} tone="green" sub={`harvested ${usd(v.stats.totalHarvested, 2)} · ${v.stats.refinanceCount} hop${v.stats.refinanceCount === 1 ? "" : "s"}`} />
          <Stat label="Net value" value={usd(v.netValueUsd)} sub={`liquidity ${usd(v.lpValueUsd)} · idle ${amount(v.balances.loan, 2)} ${v.loan.symbol}`} />
        </div>
        <div className="vault-top" style={{ marginTop: 18 }}>
        <div className="card ltv-card">
          <Gauge ltv={p.ltv} max={v.policy.maxLtvBps / 10_000} trigger={v.policy.triggerLtvBps / 10_000} lltv={v.market.lltv} />
          <div>
            <LtvBar ltv={p.ltv} max={v.policy.maxLtvBps / 10_000} trigger={v.policy.triggerLtvBps / 10_000} lltv={v.market.lltv} />
            <div className="row faint mono" style={{ fontSize: 12, marginTop: 10 }}>
              <span>health {p.healthFactor === null ? "—" : p.healthFactor.toFixed(2)}</span>
              <span>liquidation price {p.liquidationPrice === null ? "—" : usd(p.liquidationPrice, 2)}</span>
              {p.ltvBps !== null && p.ltvBps >= v.policy.triggerLtvBps ? <span className="pill r">at trigger — protection due</span> : <span className="pill g">inside policy</span>}
            </div>
          </div>
        </div>
        <VaultLog
          entries={act ? act.entries : null}
          refreshedAt={refreshedAt}
          now={{ price: p.collateralPrice, ltvBps: p.ltvBps, triggerBps: v.policy.triggerLtvBps, maxBps: v.policy.maxLtvBps, paused: v.paused, symbol: v.collateral.symbol, next: plan?.actions[0] ? (NEXT_WORDS[plan.actions[0].kind] ?? plan.actions[0].kind) : null }}
        />
        </div>

        <div className="tabs" style={{ marginTop: 32 }}>
          {(["position", "agent", "activity", "settings"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "agent" ? "What happens next" : t === "position" ? "Your loan" : t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>

        {tx.error && <p className="note bad" style={{ marginBottom: 14 }}>{tx.error}</p>}
        {tx.busy && <p className="note" style={{ marginBottom: 14 }}>{tx.step}</p>}
        {tx.hash && !tx.busy && tx.outcome === "confirmed" && <p className="note good" style={{ marginBottom: 14 }}>Confirmed: <TxLink hash={tx.hash} /></p>}
        {tx.hash && !tx.busy && tx.outcome === null && <p className="note" style={{ marginBottom: 14 }}>Sent, still pending: <TxLink hash={tx.hash} /> · <button className="btn xs" onClick={refresh}>refresh</button></p>}
        {isOperator && v.paused && <p className="note warn" style={{ marginBottom: 14 }}>Auto-repay is turned off for this loan. Only the owner can turn it back on.</p>}

        {tab === "position" && (
          <div className="grid g2">
            <div>
              <h3>Liquidity positions</h3>
              {v.lp.length === 0 ? <p className="note" style={{ marginTop: 10 }}>No open positions. {v.balances.loan > 0 ? `${amount(v.balances.loan, 2)} ${v.loan.symbol} sits idle in the vault; auto-repay puts it to work on its next pass, or open a position below.` : "Borrow first; what you borrow is put to work automatically."}</p> : v.lp.map((l) => (
                <div className="panel" key={l.tokenId} style={{ marginTop: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}><span className="med">#{l.tokenId} · {l.fee / 10_000}% pool</span>{l.inRange ? <span className="pill g">in range</span> : <span className="pill a">out of range</span>}</div>
                  <div className="kv"><span>Range</span><b>{l.priceLower === null ? "—" : usd(l.priceLower, 2)} – {l.priceUpper === null ? "—" : usd(l.priceUpper, 2)} <span className="lbl">now {l.currentPrice === null ? "—" : usd(l.currentPrice, 2)}</span></b></div>
                  <div className="kv"><span>Holds</span><b>{amount(l.amountCollateral)} {v.collateral.symbol} + {amount(l.amountLoan, 2)} {v.loan.symbol} = {usd(l.valueUsd, 2)}</b></div>
                  <div className="kv"><span>Uncollected fees</span><b className="green">{l.uncollected ? `${usd(l.uncollected.usd, 2)} (${amount(l.uncollected.collateral)} ${v.collateral.symbol} + ${amount(l.uncollected.loan, 2)} ${v.loan.symbol})` : "—"}</b></div>
                  <div className="kv"><span>Cost basis</span><b>{usd(l.costBasis, 2)} → {l.valueUsd === null || !(l.costBasis > 0) ? "—" : `${((l.valueUsd + (l.uncollected?.usd ?? 0)) / l.costBasis * 100 - 100).toFixed(2)}%`}</b></div>
                  {can && <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn xs" style={{ borderColor: "var(--panel-mute)", color: "var(--panel-ink)" }} disabled={tx.busy} onClick={() => send({ action: "harvest", tokenId: l.tokenId })}>Harvest → debt</button>
                    <button className="btn xs" style={{ borderColor: "var(--panel-mute)", color: "var(--panel-ink)" }} disabled={tx.busy} onClick={() => send({ action: "closeLp", tokenId: l.tokenId, swapToLoan: true })}>Close → repay</button>
                    <button className="btn xs" style={{ borderColor: "var(--panel-mute)", color: "var(--panel-ink)" }} disabled={tx.busy} onClick={() => send({ action: "closeLp", tokenId: l.tokenId, swapToLoan: false })}>Close, keep both</button>
                  </div>}
                </div>
              ))}
              {can && <OpenLpForm vault={v} busy={tx.busy} onSend={send} />}
            </div>
            <div>
              <h3>Collateral and debt</h3>
              <div className="card" style={{ marginTop: 10 }}>
                <div className="kv"><span>Collateral in Morpho</span><b>{amount(p.collateral)} {v.collateral.symbol}</b></div>
                <div className="kv"><span>Debt</span><b>{usd(p.debt, 2)}</b></div>
                <div className="kv"><span>Room to borrow (policy)</span><b>{maxBorrow === null ? "—" : usd(Math.max(0, maxBorrow), 2)}</b></div>
                <div className="kv"><span>Idle in vault</span><b>{amount(v.balances.loan, 2)} {v.loan.symbol} · {amount(v.balances.collateral)} {v.collateral.symbol}</b></div>
                <div className="kv"><span>Total borrowed / repaid</span><b>{usd(v.stats.totalBorrowed, 2)} / {usd(v.stats.totalRepaid, 2)}</b></div>
                <div className="kv"><span>Protocol fees paid</span><b>{usd(v.stats.totalProtocolFees, 2)}</b></div>
              </div>
              {isOwner && <div id="f-deposit" />}
              {isOwner && <AmountForm label={`Deposit ${v.collateral.symbol} collateral`} hint="approve, then deposit into Morpho under the vault" busy={tx.busy} onSubmit={(a) => send({ action: "depositCollateral", amount: a })} />}
              {can && <div id="f-borrow" />}
              {can && <AmountForm label={`Borrow ${v.loan.symbol}`} hint={maxBorrow === null ? "" : `up to ${usd(Math.max(0, maxBorrow), 2)} within the policy ceiling`} busy={tx.busy} onSubmit={(a) => send({ action: "borrow", amount: a })} />}
              {can && <AmountForm label={`Repay ${v.loan.symbol} from the vault`} hint="empty = everything the vault holds" busy={tx.busy} allowEmpty onSubmit={(a) => send({ action: "repay", amount: a || undefined })} />}
              {isOwner && <AmountForm label={`Deposit ${v.loan.symbol}`} hint="to repay, or to LP without borrowing" busy={tx.busy} onSubmit={(a) => send({ action: "depositLoanToken", amount: a })} />}
              {isOwner && <AmountForm label={`Withdraw ${v.collateral.symbol} collateral`} hint="to the owner; Morpho refuses if it would leave the loan unhealthy" busy={tx.busy} onSubmit={(a) => send({ action: "withdrawCollateral", amount: a })} />}
              {isOwner && <div className="row" style={{ marginTop: 12 }}>
                <button className="btn xs" disabled={tx.busy || v.balances.loan === 0} onClick={() => send({ action: "withdrawToken", token: v.loan.address })}>Withdraw idle {v.loan.symbol}</button>
                <button className="btn xs" disabled={tx.busy || v.balances.collateral === 0} onClick={() => send({ action: "withdrawToken", token: v.collateral.address })}>Withdraw idle {v.collateral.symbol}</button>
              </div>}
              {!w.address && <p className="note" style={{ marginTop: 12 }}>Connect the owner wallet to act on this vault.</p>}
            </div>
          </div>
        )}

        {tab === "agent" && (
          <div>
            <p className="lede" style={{ marginTop: 0 }}>What auto-repay will do on its next pass, worked out from this loan's state right now, with the reason for each step. You can do any of it yourself first.</p>
            {panelErr.plan ? <p className="note bad" style={{ marginTop: 16 }}>The plan could not be evaluated: {panelErr.plan} <button className="btn xs" onClick={refresh}>retry</button></p> : !plan ? <p style={{ marginTop: 16 }}><span className="spinner" /> evaluating the rules against this vault…</p> : (
              <>
                <div className="panel term" style={{ marginTop: 16 }}>
                  <div><span className="k">$</span> payoff plan --vault {v.address.slice(0, 10)}… <span className="d">{new Date(plan.at).toLocaleTimeString()}</span></div>
                  {plan.skipped.map((s, i) => <div key={i}><span className="d">· {s.rule}:</span> {s.why}</div>)}
                  {plan.actions.map((a, i) => <div key={"a" + i}><span className="k">▶ {a.kind}</span> {a.reason}</div>)}
                  <div className="cur">{plan.actions.length === 0 ? "nothing to sign this tick" : `${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"} ready to sign`}</div>
                </div>
                {plan.actions.length === 0 && <p className="note good" style={{ marginTop: 16 }}>Nothing to do right now.</p>}
                {plan.actions.map((a, i) => (
                  <div className="panel" key={i} style={{ marginTop: 12 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}><span className="med">{a.kind.toUpperCase()}</span>{a.valueUsd !== null && <span className="green mono">{usd(a.valueUsd, 2)}{a.kind === "refinance" ? "/yr" : ""}</span>}</div>
                    <p style={{ marginTop: 8 }}>{a.reason}</p>
                    <p className="lbl" style={{ marginTop: 8 }}>{a.built.tx.description}</p>
                    {a.built.notes?.map((n, j) => <p key={j} className="lbl" style={{ marginTop: 4, textTransform: "none", letterSpacing: 0 }}>{n}</p>)}
                    {can && <div className="row" style={{ marginTop: 12 }}><button className="btn xs" style={{ borderColor: "var(--panel-mute)", color: "var(--panel-ink)" }} disabled={tx.busy} onClick={() => sendPlanned(a, plan, v, send)}>Sign this now</button></div>}
                  </div>
                ))}
                <h3 style={{ marginTop: 28 }}>Rules that did not fire</h3>
                <div className="card soft" style={{ marginTop: 10 }}>{plan.skipped.map((s, i) => <div className="kv" key={i}><span>{s.rule}</span><b style={{ fontWeight: 400, textAlign: "right" }}>{s.why}</b></div>)}</div>
                <p className="faint mono" style={{ fontSize: 11, marginTop: 10 }}>evaluated {new Date(plan.at).toLocaleTimeString()} · settings {JSON.stringify(plan.settings)}</p>
              </>
            )}
          </div>
        )}

        {tab === "activity" && (
          <div className="log">
            {panelErr.activity && <p className="note bad">Activity could not be read: {panelErr.activity}</p>}
            {act?.partial && <p className="note" style={{ marginBottom: 10 }}>Showing recent activity only (the RPC could not scan further back in time). Older events are on the <a href={`${EXPLORER}/address/${v.address}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>explorer ↗</a>.</p>}
            {!act && !panelErr.activity ? <p className="skeleton">reading events</p> : !act ? null : act.entries.length === 0 ? <Empty>No activity yet.</Empty> : act.entries.map((e, i) => (
              <div className="e" key={i}>
                <span className="t">{e.time ? new Date(e.time * 1000).toLocaleString() : `block ${e.block}`}</span>
                <span className="ty">{e.title}</span>
                <span className="d">{e.detail}</span>
                <TxLink hash={e.tx} />
              </div>
            ))}
          </div>
        )}

        {tab === "settings" && (
          <div className="grid g2">
            <div>
              <h3>Policy</h3>
              <PolicyForm policy={v.policy} lltv={v.market.lltv} busy={tx.busy} disabled={!isOwner} onSubmit={(pol) => send({ action: "setPolicy", policy: pol })} />
              <h3 style={{ marginTop: 28 }}>Operator</h3>
              <div className="card" style={{ marginTop: 10 }}>
                <div className="kv"><span>Current</span><b>{v.operator}</b></div>
                {isOwner && <AddressForm label="New operator" busy={tx.busy} onSubmit={(a) => send({ action: "setOperator", operator: a })} />}
              </div>
              <h3 style={{ marginTop: 28 }}>Ownership</h3>
              <div className="card" style={{ marginTop: 10 }}>
                <div className="kv"><span>Owner</span><b>{v.owner}</b></div>
                {v.pendingOwner !== "0x0000000000000000000000000000000000000000" && <div className="kv"><span>Pending</span><b>{v.pendingOwner} {w.address?.toLowerCase() === v.pendingOwner.toLowerCase() && <button className="btn xs" disabled={tx.busy} onClick={() => send({ action: "acceptOwnership" })}>Accept</button>}</b></div>}
                {isOwner && <AddressForm label="Propose new owner (they must accept)" busy={tx.busy} onSubmit={(a) => send({ action: "proposeOwner", newOwner: a })} />}
              </div>
            </div>
            <div>
              <h3>Markets the loan may move to</h3>
              <p className="faint" style={{ fontSize: 13, marginTop: 6 }}>Same collateral only. The debt moves when an allowed market is cheaper by at least the savings threshold, has the liquidity, and keeps LTV inside the ceiling.</p>
              <div className="tblwrap" style={{ marginTop: 10 }}>
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th>Market</th><th className="r">LLTV</th><th className="r">Borrow APY</th><th className="r">Available</th><th className="r">Allowed</th></tr></thead>
                  <tbody>
                    {(targets ?? []).map((t) => {
                      const allowed = v.allowedMarkets.includes(t.id);
                      const current = t.id === v.market.id;
                      return (
                        <tr key={t.id}>
                          <td className="mono">{t.id.slice(0, 10)}… {current && <span className="pill g">current</span>} {t.listed && <span className="pill">listed</span>}</td>
                          <td className="r">{(t.lltv * 100).toFixed(1)}%</td>
                          <td className="r">{pct(t.borrowApy)}</td>
                          <td className="r">{usd(Number(t.liquidity) / 10 ** v.loan.decimals)}</td>
                          <td className="r">{isOwner && !current ? <button className="btn xs" disabled={tx.busy} onClick={() => send({ action: "setMarketAllowed", marketId: t.id, allowed: !allowed })}>{allowed ? "Remove" : "Allow"}</button> : allowed ? "yes" : "no"}</td>
                        </tr>
                      );
                    })}
                    {!targets && <tr><td colSpan={5} className="faint">{panelErr.targets ? `could not read the pair's markets: ${panelErr.targets}` : "reading…"}</td></tr>}
                  </tbody>
                </table>
              </div>
              {can && targets && <div style={{ marginTop: 12 }}><RefinanceForm targets={targets.filter((t) => v.allowedMarkets.includes(t.id) && t.id !== v.market.id)} busy={tx.busy} onSubmit={(id) => send({ action: "refinance", marketId: id })} /></div>}
              <h3 style={{ marginTop: 28 }}>Liquidation protection</h3>
              <div className="card" style={{ marginTop: 10 }}>
                <p>Fires once LTV is at or above {bps(v.policy.triggerLtvBps)}: repays {bps(v.policy.repayBps)} of the debt, first from idle {v.loan.symbol}, then by closing positions, then by selling collateral through a Morpho flash loan.</p>
                {can && <div className="row" style={{ marginTop: 12 }}><button className="btn xs danger" disabled={tx.busy || p.ltvBps === null || p.ltvBps < v.policy.triggerLtvBps} onClick={() => send({ action: "protect" })}>Run protection now</button><span className="faint" style={{ fontSize: 12 }}>{p.ltvBps !== null && p.ltvBps < v.policy.triggerLtvBps ? "below the trigger; the vault would refuse" : ""}</span></div>}
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function sendPlanned(a: PlanAction, plan: Plan, v: Vault, send: (b: unknown) => void) {
  // The plan carries calldata already; rebuilding through the tx route keeps the wallet
  // flow (approvals, receipt) identical. The plan's structured args say which position
  // or market each action targets, so two harvests never collapse into one.
  if (a.kind === "protect") return send({ action: "protect" });
  if (a.kind === "refinance") return send({ action: "refinance", marketId: a.args.marketId });
  if (a.kind === "harvest") return send({ action: "harvest", tokenId: a.args.tokenId });
  if (a.kind === "close") return send({ action: "closeLp", tokenId: a.args.tokenId, swapToLoan: true });
  if (a.kind === "open") { const width = Number(String(plan.settings.rangeWidthPct ?? 5)); return send({ action: "openLp", amount: v.balances.loan.toFixed(v.loan.decimals), fee: a.args.fee ?? 500, widthPct: width, slippageBps: v.policy.maxSlippageBps }); }
}

function AmountForm({ label, hint, busy, onSubmit, allowEmpty }: { label: string; hint?: string; busy: boolean; onSubmit: (a: string) => void; allowEmpty?: boolean }) {
  const [a, setA] = useState("");
  return (
    <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); onSubmit(a); }}>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{label}</label><input placeholder={allowEmpty ? "all" : "0.0"} value={a} onChange={(e) => setA(e.target.value.trim())} />{hint && <span className="hint">{hint}</span>}</div>
      <button className="btn sm" type="submit" disabled={busy || (!allowEmpty && !/^\d*\.?\d+$/.test(a))}>Sign</button>
    </form>
  );
}

function AddressForm({ label, busy, onSubmit }: { label: string; busy: boolean; onSubmit: (a: string) => void }) {
  const [a, setA] = useState("");
  return (
    <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); onSubmit(a); }}>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>{label}</label><input placeholder="0x…" value={a} onChange={(e) => setA(e.target.value.trim())} /></div>
      <button className="btn sm" type="submit" disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(a)}>Sign</button>
    </form>
  );
}

function PolicyForm({ policy, lltv, busy, disabled, onSubmit }: { policy: Vault["policy"]; lltv: number; busy: boolean; disabled: boolean; onSubmit: (p: Vault["policy"]) => void }) {
  const [p, setP] = useState(policy);
  useEffect(() => setP(policy), [policy]);
  const ok = p.maxLtvBps <= 9500 && p.triggerLtvBps >= p.maxLtvBps && p.triggerLtvBps < lltv * 10_000 && p.repayBps > 0 && p.repayBps <= 10_000 && p.maxSlippageBps <= 2000;
  return (
    <form className="card" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); onSubmit(p); }}>
      <div className="grid g2" style={{ gap: 12 }}>
        {([["maxLtvBps", "Borrow ceiling"], ["triggerLtvBps", "Protect at"], ["repayBps", "Repay share"], ["maxSlippageBps", "Max slippage"]] as const).map(([k, l]) => (
          <div className="field" key={k} style={{ marginBottom: 0 }}><label>{l} (%)</label><input type="number" step={0.5} disabled={disabled} value={(p[k] / 100).toString()} onChange={(e) => setP({ ...p, [k]: Math.round(Number(e.target.value) * 100) })} /></div>
        ))}
      </div>
      {!ok && <p className="note bad" style={{ marginTop: 10 }}>Ceiling ≤ 95%, trigger between the ceiling and the market's {(lltv * 100).toFixed(0)}% LLTV, repay 0–100%, slippage ≤ 20%.</p>}
      {!disabled && <div className="row" style={{ marginTop: 12 }}><button className="btn sm" type="submit" disabled={busy || !ok}>Sign policy</button></div>}
    </form>
  );
}

function OpenLpForm({ vault, busy, onSend }: { vault: Vault; busy: boolean; onSend: (b: unknown) => void }) {
  const [amt, setAmt] = useState("");
  const [fee, setFee] = useState(500);
  const [width, setWidth] = useState(5);
  const [pools, setPools] = useState<Array<{ fee: number; price: number | null; tvlUsd: number | null; volume: { feeApr: number | null; volumeLoan: number; hours: number } | null }> | null>(null);
  useEffect(() => { get<{ pools: any[] }>(`/api/pools?collateral=${vault.collateral.address}`).then((d) => { setPools(d.pools); if (d.pools[0]) setFee(d.pools[0].fee); }).catch(() => setPools([])); }, [vault.collateral.address]);
  return (
    <form className="card" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); onSend({ action: "openLp", amount: amt, fee, widthPct: width, slippageBps: vault.policy.maxSlippageBps }); }}>
      <h3>Open a position by hand</h3>
      <p>Half the amount is swapped into {vault.collateral.symbol} so the range holds both sides. Auto-repay does this on its own for idle {vault.loan.symbol}.</p>
      <div className="grid g3" style={{ gap: 12, marginTop: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}><label>{vault.loan.symbol} to commit</label><input placeholder={vault.balances.loan.toFixed(2)} value={amt} onChange={(e) => setAmt(e.target.value.trim())} /><span className="hint">idle: {amount(vault.balances.loan, 2)}</span></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Pool</label><select value={fee} onChange={(e) => setFee(Number(e.target.value))}>{(pools ?? []).map((p) => <option key={p.fee} value={p.fee}>{p.fee / 10_000}% · {p.volume?.feeApr !== null && p.volume ? `≈${(p.volume.feeApr! * 100).toFixed(0)}% APR` : "no volume"} · TVL {usd(p.tvlUsd)}</option>)}{pools === null && <option>reading pools…</option>}</select></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Range ± %</label><input type="number" min={0} max={200} step={0.5} value={width} onChange={(e) => setWidth(Number(e.target.value))} /><span className="hint">0 = full range</span></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn sm" type="submit" disabled={busy || !/^\d*\.?\d+$/.test(amt)}>Sign open</button></div>
    </form>
  );
}

function RefinanceForm({ targets, busy, onSubmit }: { targets: Target[]; busy: boolean; onSubmit: (id: string) => void }) {
  const [id, setId] = useState(targets[0]?.id ?? "");
  useEffect(() => { if (!id && targets[0]) setId(targets[0].id); }, [targets, id]);
  if (targets.length === 0) return <p className="note">Allow at least one other market to refinance by hand.</p>;
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); onSubmit(id); }}>
      <select value={id} onChange={(e) => setId(e.target.value)} style={{ padding: "8px 12px", border: "1px solid var(--rule-2)", borderRadius: 10, background: "#fff", flex: 1 }}>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.id.slice(0, 10)}… · LLTV {(t.lltv * 100).toFixed(0)}% · {pct(t.borrowApy)}</option>)}
      </select>
      <button className="btn sm" type="submit" disabled={busy || !id}>Refinance now</button>
    </form>
  );
}
