"use client";

import Link from "next/link";
import Nav from "../components/Nav";
import { useLive } from "../components/useLive";
import { DataBanner, Empty, Tok, bps } from "../components/ui";
import { usd, short } from "../components/format";
import { FACTORY } from "../components/brand";

type Entry = { rank: number; address: string; owner: string; collateral: { symbol: string }; debt: number; collateralUsd: number | null; ltvBps: number | null; totalRepaidFromFees: number; totalHarvested: number; refinanceCount: number; openPositions: number; repaidPct: number | null; createdAt: number; showcase: boolean };
type Resp = { entries: Entry[]; totals: { vaults: number; debtUsd: number; collateralUsd: number; repaidFromFeesUsd: number; harvestedUsd: number; refinances: number; openPositions: number; showcase?: number }; cachedAt: string; stale: boolean };

export default function Leaderboard() {
  const r = useLive<Resp>("/api/leaderboard", { entries: [], totals: { vaults: 0, debtUsd: 0, collateralUsd: 0, repaidFromFeesUsd: 0, harvestedUsd: 0, refinances: 0, openPositions: 0 }, cachedAt: "", stale: false }, !!FACTORY);
  const t = r.data!.totals;
  return (
    <>
      <Nav />
      <DataBanner live={r.live} loading={r.loading} error={r.error} what={FACTORY ? "Leaderboard" : "Leaderboard: contracts not deployed yet"} />
      <main className="wrap" style={{ padding: "48px 24px 80px" }}>
        <span className="eyebrow">Leaderboard</span>
        <h2>Whose loan is paying itself down fastest.</h2>
        <p className="lede">Every vault the factory has made, ranked by USDG repaid out of trading fees. On-chain numbers only; addresses only. Vaults the team runs with its own money are marked <span className="pill a">team showcase</span>.</p>
        <div className="stats" style={{ marginTop: 28 }}>
          <div className="stat"><span className="lbl">Vaults</span><span className="big">{t.vaults}</span></div>
          <div className="stat"><span className="lbl">Repaid from fees</span><span className="big green">{usd(t.repaidFromFeesUsd, 2)}</span></div>
          <div className="stat"><span className="lbl">Fees harvested</span><span className="big">{usd(t.harvestedUsd, 2)}</span></div>
          <div className="stat"><span className="lbl">Refinances</span><span className="big">{t.refinances}</span></div>
        </div>
        <div className="tblwrap" style={{ marginTop: 28 }}>
          {r.data!.entries.length === 0 ? (
            <Empty>{FACTORY ? (r.loading ? "Reading vaults…" : <span>No vaults yet. The contracts are live; <Link href="/deploy" style={{ textDecoration: "underline" }}>deploy the first agent</Link>.</span>) : "The factory is not deployed on this site yet."}</Empty>
          ) : (
            <table className="tbl">
              <thead><tr><th>#</th><th>Vault</th><th>Pair</th><th className="r">Repaid from fees</th><th className="r">of debt</th><th className="r">Harvested</th><th className="r">Debt</th><th className="r">LTV</th><th className="r">Hops</th><th className="r">Positions</th></tr></thead>
              <tbody>
                {r.data!.entries.map((e) => (
                  <tr key={e.address}>
                    <td>{e.rank}</td>
                    <td><Link href={`/vault/${e.address}`} className="mono" style={{ textDecoration: "underline" }}>{short(e.address)}</Link> {e.showcase && <span className="pill a" title="Run by the PAYOFF team with its own funds so the mechanics can be watched live. Not an independent user.">team showcase</span>}<div className="faint" style={{ fontSize: 11 }}>owner {short(e.owner)}</div></td>
                    <td><Tok symbol={e.collateral.symbol} /> <span className="faint">/ USDG</span></td>
                    <td className="r green">{usd(e.totalRepaidFromFees, 2)}</td>
                    <td className="r">{e.repaidPct === null ? "—" : (e.repaidPct * 100).toFixed(1) + "%"}</td>
                    <td className="r">{usd(e.totalHarvested, 2)}</td>
                    <td className="r">{usd(e.debt, 2)}</td>
                    <td className="r">{bps(e.ltvBps)}</td>
                    <td className="r">{e.refinanceCount}</td>
                    <td className="r">{e.openPositions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
