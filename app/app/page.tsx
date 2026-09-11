"use client";

import Link from "next/link";
import Nav from "../components/Nav";
import { useLive } from "../components/useLive";
import { useWallet } from "../components/WalletProvider";
import { DataBanner, Empty, LtvBar, TokenLogo, bps } from "../components/ui";
import { usd, short, ago } from "../components/format";
import { FACTORY } from "../components/brand";

type Row = { address: string; owner: string; operator: string; paused: boolean; createdAt: number; collateral: { symbol: string; address: string }; loan: { symbol: string }; debt: number; collateral_: number; collateralUsd: number | null; ltvBps: number | null; lltv: number; totalRepaidFromFees: number; totalHarvested: number; refinanceCount: number; openPositions: number; policy: { maxLtvBps: number; triggerLtvBps: number; repayBps: number; maxSlippageBps: number } };
type Resp = { count: number; vaults: Row[] };

export default function Dashboard() {
  const w = useWallet();
  const r = useLive<Resp>(w.address ? `/api/vaults?owner=${w.address}` : "/api/vaults", { count: 0, vaults: [] }, !!FACTORY && !!w.address);
  const vaults = r.data?.vaults ?? [];
  const totals = vaults.reduce((a, v) => ({ debt: a.debt + v.debt, coll: a.coll + (v.collateralUsd ?? 0), fees: a.fees + v.totalRepaidFromFees }), { debt: 0, coll: 0, fees: 0 });

  return (
    <>
      <Nav />
      <DataBanner live={r.live || !w.address} loading={r.loading} error={r.error} what="Your vaults" />
      <main className="wrap" style={{ padding: "48px 24px 80px" }}>
        <span className="eyebrow">Dashboard</span>
        <h2>Your vaults.</h2>
        {!w.address ? (
          <div style={{ marginTop: 28 }}>
            <Empty>Connect the wallet that owns your loans, or open your first one. <span className="row" style={{ justifyContent: "center", marginTop: 16 }}><button className="btn primary" onClick={w.connect}>Connect wallet</button><Link className="btn" href="/borrow">Open a loan</Link></span></Empty>
          </div>
        ) : !FACTORY ? (
          <div style={{ marginTop: 28 }}><Empty>The vault factory is not deployed on this site yet. Set NEXT_PUBLIC_PAYOFF_FACTORY_ADDRESS after running the deploy script.</Empty></div>
        ) : (
          <>
            <div className="stats" style={{ marginTop: 28 }}>
              <div className="stat"><span className="lbl">Vaults</span><span className="big">{vaults.length}</span></div>
              <div className="stat"><span className="lbl">Collateral</span><span className="big">{usd(totals.coll)}</span></div>
              <div className="stat"><span className="lbl">Debt</span><span className="big">{usd(totals.debt, 2)}</span></div>
              <div className="stat"><span className="lbl">Repaid from fees</span><span className="big green">{usd(totals.fees, 2)}</span></div>
            </div>
            <div className="grid g2" style={{ marginTop: 28 }}>
              {vaults.map((v) => (
                <Link key={v.address} href={`/vault/${v.address}`} className="card vault-card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="hd"><span className="logo"><TokenLogo symbol={v.collateral.symbol} size={40} /></span><span><span className="sym" style={{ display: "block", fontFamily: "var(--display)", fontWeight: 800, fontSize: 18 }}>{v.collateral.symbol} <span className="faint" style={{ fontWeight: 500, fontSize: 13 }}>/ {v.loan.symbol}</span></span><span className="faint mono" style={{ fontSize: 11 }}>{short(v.address)}</span></span></span>
                    <span className="row">{v.paused ? <span className="pill a">auto-repay off</span> : <span className="pill g">auto-repay on</span>}</span>
                  </div>
                  <div className="grid g3" style={{ marginTop: 16, gap: 12 }}>
                    <div className="card soft" style={{ padding: 12 }}><span className="lbl">Collateral</span><span className="med">{usd(v.collateralUsd)}</span><span className="faint" style={{ fontSize: 11 }}>{v.collateral_.toLocaleString("en-US", { maximumFractionDigits: 4 })} {v.collateral.symbol}</span></div>
                    <div className="card soft" style={{ padding: 12 }}><span className="lbl">Debt</span><span className="med">{usd(v.debt, 2)}</span><span className="faint" style={{ fontSize: 11 }}>LTV {bps(v.ltvBps)}</span></div>
                    <div className="card soft" style={{ padding: 12 }}><span className="lbl">Repaid from fees</span><span className="med green">{usd(v.totalRepaidFromFees, 2)}</span><span className="faint" style={{ fontSize: 11 }}>{v.openPositions} position{v.openPositions === 1 ? "" : "s"} · {v.refinanceCount} hop{v.refinanceCount === 1 ? "" : "s"}</span></div>
                  </div>
                  <div style={{ marginTop: 14 }}><LtvBar ltv={v.ltvBps === null ? null : v.ltvBps / 10_000} max={v.policy.maxLtvBps / 10_000} trigger={v.policy.triggerLtvBps / 10_000} lltv={v.lltv} /></div>
                  <div className="faint mono" style={{ fontSize: 11, marginTop: 10 }}>created {ago(v.createdAt)} · operator {short(v.operator)}</div>
                </Link>
              ))}
              {vaults.length === 0 && !r.loading && (
                <div style={{ gridColumn: "1 / -1" }}><Empty>No vaults for {short(w.address)} yet. <span className="row" style={{ justifyContent: "center", marginTop: 16 }}><Link className="btn green" href="/borrow">Deploy an agent</Link></span></Empty></div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
