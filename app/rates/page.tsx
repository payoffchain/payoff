"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Nav from "../components/Nav";
import { useLive } from "../components/useLive";
import { DataBanner, Tok, pct } from "../components/ui";
import { usd } from "../components/format";
import { CHAIN_NAME } from "../components/brand";

type Row = { id: string; lltv: number; listed: boolean; borrowApy: number | null; supplyApy: number | null; utilization: number; liquidityUsd: number; totalSupplyUsd: number; totalBorrowUsd: number; collateralPrice: number | null; live: boolean };
type Group = { collateral: { address: string; symbol: string; isStock: boolean }; best: Row | null; rows: Row[] };
type Board = { live: boolean; stale: boolean; error: string | null; statesCachedAt: string | null; snapshot: { fetchedAt: string }; minLiquidityUsd: number; groups: Group[] };

export default function Rates() {
  const [stocksOnly, setStocksOnly] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const b = useLive<Board>("/api/markets", { live: false, stale: false, error: null, statesCachedAt: null, snapshot: { fetchedAt: "" }, minLiquidityUsd: 100, groups: [] });
  const groups = useMemo(() => {
    let g = b.data?.groups ?? [];
    if (stocksOnly) g = g.filter((x) => x.collateral.isStock);
    if (q.trim()) g = g.filter((x) => x.collateral.symbol.toLowerCase().includes(q.trim().toLowerCase()));
    return g;
  }, [b.data, stocksOnly, q]);

  return (
    <>
      <Nav />
      <DataBanner live={b.live && !!b.data?.live} loading={b.loading} error={b.error ?? b.data?.error ?? null} what={b.data && !b.data.live ? `Live rates unavailable — showing the snapshot from ${b.data.snapshot.fetchedAt.slice(0, 16).replace("T", " ")} UTC` : "Morpho rates"} />
      <main className="wrap" style={{ padding: "48px 24px 80px" }}>
        <span className="eyebrow">Rate comparison · Morpho Blue on {CHAIN_NAME}</span>
        <h2>Every USDC market, by collateral.</h2>
        <p className="lede">Borrow APY is read from each market's interest-rate model on chain. The cheapest market with at least {usd(b.data?.minLiquidityUsd ?? 100)} available is marked best. Click a collateral to see all of its markets — that spread is what a vault can hop between.</p>
        <div className="row" style={{ marginTop: 22 }}>
          <div className="seg"><button className={stocksOnly ? "on" : ""} onClick={() => setStocksOnly(true)}>BTC & ETH</button><button className={!stocksOnly ? "on" : ""} onClick={() => setStocksOnly(false)}>All collateral</button></div>
          <input placeholder="Search ticker" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: "8px 12px", border: "1px solid var(--rule-2)", borderRadius: 999, background: "#fff" }} />
          <span className="faint mono" style={{ fontSize: 12 }}>{b.data?.statesCachedAt ? `rates as of ${new Date(b.data.statesCachedAt).toLocaleTimeString()}` : ""}</span>
        </div>
        <div className="tblwrap" style={{ marginTop: 22 }}>
          <table className="tbl">
            <thead><tr><th>Collateral</th><th className="r">Price (oracle)</th><th className="r">Best borrow</th><th className="r">at LLTV</th><th className="r">Available</th><th className="r">Supplied</th><th className="r">Borrowed</th><th className="r">Markets</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const supplied = g.rows.reduce((a, r) => a + r.totalSupplyUsd, 0);
                const borrowed = g.rows.reduce((a, r) => a + r.totalBorrowUsd, 0);
                const isOpen = open === g.collateral.address;
                return [
                  <tr key={g.collateral.address} onClick={() => setOpen(isOpen ? null : g.collateral.address)} style={{ cursor: "pointer" }}>
                    <td><Tok symbol={g.collateral.symbol} /></td>
                    <td className="r">{g.best?.collateralPrice !== null && g.best?.collateralPrice !== undefined ? usd(g.best.collateralPrice, 2) : g.rows[0]?.collateralPrice ? usd(g.rows[0].collateralPrice, 2) : "—"}</td>
                    <td className="r green">{g.best ? pct(g.best.borrowApy) : <span className="faint">no liquidity</span>}</td>
                    <td className="r">{g.best ? (g.best.lltv * 100).toFixed(0) + "%" : "—"}</td>
                    <td className="r">{g.best ? usd(g.best.liquidityUsd) : "—"}</td>
                    <td className="r">{usd(supplied)}</td>
                    <td className="r">{usd(borrowed)}</td>
                    <td className="r">{g.rows.length} {isOpen ? "▴" : "▾"}</td>
                  </tr>,
                  isOpen && (
                    <tr key={g.collateral.address + "-x"}>
                      <td colSpan={8} style={{ background: "var(--paper-2)", padding: 0 }}>
                        <table className="tbl" style={{ fontSize: 12 }}>
                          <thead><tr><th>Market</th><th className="r">LLTV</th><th className="r">Borrow APY</th><th className="r">Supply APY</th><th className="r">Utilisation</th><th className="r">Available</th><th className="r">Supplied</th><th className="r">Borrowed</th><th></th></tr></thead>
                          <tbody>
                            {g.rows.map((r) => (
                              <tr key={r.id}>
                                <td className="mono">{r.id.slice(0, 10)}… {r.listed ? <span className="pill g">listed</span> : null}{g.best?.id === r.id ? <span className="pill g" style={{ marginLeft: 6 }}>best</span> : null}</td>
                                <td className="r">{(r.lltv * 100).toFixed(1)}%</td>
                                <td className="r">{pct(r.borrowApy)}</td>
                                <td className="r">{pct(r.supplyApy)}</td>
                                <td className="r">{pct(r.utilization, 0)}</td>
                                <td className="r">{usd(r.liquidityUsd)}</td>
                                <td className="r">{usd(r.totalSupplyUsd)}</td>
                                <td className="r">{usd(r.totalBorrowUsd)}</td>
                                <td className="r"><Link className="btn xs" href={`/borrow?market=${r.id}`}>Borrow here</Link></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
              {groups.length === 0 && <tr><td colSpan={8} className="faint">{b.loading ? "Reading markets…" : "Nothing matches."}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 24 }}>Market params (tokens, oracle, IRM, LLTV) come from a snapshot of the Morpho API; rates, totals and oracle prices are read on chain each time. A market with tiny liquidity can show any rate — that is why "best" needs a minimum.</p>
      </main>
    </>
  );
}
