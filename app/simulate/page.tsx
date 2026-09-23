"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Nav from "../components/Nav";
import { useLive } from "../components/useLive";
import { TokenLogo } from "../components/ui";
import { usd } from "../components/format";

/**
 * "What would my loan do?" Pick a stock and an amount, and see, from live numbers, how
 * much USDG you could borrow, what the pool's recent fees would pay onto the loan, what
 * the interest costs, and how long the loan would take to pay itself off at that pace.
 * A price slider shows how far the stock can fall before protection or liquidation.
 *
 * Every input is live: prices and rates from the lending markets, fees from the swaps
 * in the stock's Uniswap pool over the last 6 hours. It is an estimate, and says so.
 */

type Row = { id: string; lltv: number; borrowApy: number | null; collateralPrice: number | null; liquidityUsd: number };
type Group = { collateral: { address: string; symbol: string; isStock: boolean; name: string | null }; best: Row | null; rows: Row[] };
type Board = { live: boolean; groups: Group[] };
type Pool = { address: string; fee: number; tvlUsd: number | null; volume: { hours: number; swaps: number; volumeLoan: number; feesLoan: number; feeApr: number | null } | null };
type Pools = { pools: Pool[]; hours: number };

const PRESETS = {
  careful: { label: "Careful", maxLtv: 0.35, trigger: 0.50 },
  balanced: { label: "Balanced", maxLtv: 0.45, trigger: 0.55 },
  bold: { label: "Bold", maxLtv: 0.55, trigger: 0.60 },
};
type PresetKey = keyof typeof PRESETS;

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
function span(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "never at this pace";
  if (days < 45) return `about ${Math.round(days)} days`;
  if (days < 365 * 1.5) return `about ${Math.round(days / 30)} months`;
  return `about ${(days / 365).toFixed(1)} years`;
}

export default function Simulate() {
  const board = useLive<Board>("/api/markets", { live: false, groups: [] });
  const stocks = useMemo(() => (board.data?.groups ?? []).filter((g) => g.best && g.collateral.isStock && g.best.collateralPrice), [board.data]);
  const [sym, setSym] = useState("NVDA");
  const [shares, setShares] = useState("10");
  const [preset, setPreset] = useState<PresetKey>("balanced");
  const [move, setMove] = useState(0); // % price move for the what-if slider
  const [pools, setPools] = useState<Pools | null | "err">(null);

  const g = stocks.find((s) => s.collateral.symbol === sym) ?? stocks[0] ?? null;
  const best = g?.best ?? null;
  const price = best?.collateralPrice ?? null;

  // the pool with the most fee per dollar of liquidity, read when the stock changes
  useEffect(() => {
    if (!g) return;
    let dead = false;
    setPools(null);
    fetch(`/api/pools?collateral=${g.collateral.address}&hours=6`).then((r) => r.json()).then((j) => { if (!dead) setPools(j?.pools ? j : "err"); }).catch(() => { if (!dead) setPools("err"); });
    return () => { dead = true; };
  }, [g?.collateral.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = pools && pools !== "err" ? pools.pools.find((p) => p.volume && p.tvlUsd) ?? pools.pools[0] ?? null : null;
  const n = Number(shares);
  const ok = Number.isFinite(n) && n > 0 && price !== null && best !== null;
  const P = PRESETS[preset];

  // the arithmetic, all in USD
  const value = ok ? n * price! : 0;
  const borrow = value * P.maxLtv;
  const apy = best?.borrowApy ?? 0;
  const interestDay = (borrow * apy) / 365;
  const feesDayPool = pool?.volume ? (pool.volume.feesLoan / pool.volume.hours) * 24 : null;
  const share = pool?.tvlUsd && feesDayPool !== null ? borrow / (pool.tvlUsd + borrow) : null;
  const feesDay = share !== null && feesDayPool !== null ? feesDayPool * share : null;
  const netDay = feesDay === null ? null : feesDay - interestDay;
  const days = netDay === null || netDay <= 0 ? Infinity : borrow / netDay;
  const lltv = best?.lltv ?? 0;
  const protectAt = ok ? price! * (P.maxLtv / P.trigger) : 0;
  const liqAt = ok && lltv > 0 ? price! * (P.maxLtv / lltv) : 0;

  // what-if: the stock moves by `move` percent right after borrowing
  const moved = ok ? price! * (1 + move / 100) : 0;
  const ltvNow = ok && moved > 0 ? borrow / (n * moved) : 0;
  const state = !ok ? "" : ltvNow >= lltv ? "liquidated" : ltvNow >= P.trigger ? "protecting" : "fine";

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "40px 24px 80px", maxWidth: 1040 }}>
        <span className="eyebrow">Calculator</span>
        <h2>What would your loan do?</h2>
        <p className="lede">Pick a stock and an amount. Everything below is worked out from today's prices, rates and pool fees; it changes as they do.</p>

        <div className="sim">
          <div className="sim-in card">
            <label className="lbl">Stock</label>
            <div className="sim-stocks">
              {stocks.slice(0, 12).map((s) => (
                <button key={s.collateral.symbol} className={"sim-stock" + (s.collateral.symbol === (g?.collateral.symbol ?? "") ? " on" : "")} onClick={() => { setSym(s.collateral.symbol); setMove(0); }}>
                  <TokenLogo symbol={s.collateral.symbol} size={20} /> {s.collateral.symbol}
                </button>
              ))}
              {stocks.length === 0 && <span className="faint">{board.loading ? "reading markets…" : "no live markets right now"}</span>}
            </div>

            <label className="lbl" style={{ marginTop: 18 }}>How many shares</label>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <input inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value.trim())} style={{ width: 140 }} />
              <span className="faint">{ok ? `= ${usd(value)} at ${usd(price!)}` : price === null ? "price feed closed" : ""}</span>
            </div>

            <label className="lbl" style={{ marginTop: 18 }}>How careful</label>
            <div className="seg">
              {(Object.keys(PRESETS) as PresetKey[]).map((k) => <button key={k} className={k === preset ? "on" : ""} onClick={() => setPreset(k)}>{PRESETS[k].label}</button>)}
            </div>
            <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>borrow up to {Math.round(P.maxLtv * 100)}% of the value · repay early if it reaches {Math.round(P.trigger * 100)}%{lltv ? ` · liquidation line ${Math.round(lltv * 100)}%` : ""}</p>
          </div>

          <div className="sim-out">
            <div className="sim-big card">
              <span className="lbl">You could borrow</span>
              <b>{ok ? usd(borrow, 0) : "—"} <small>USDG</small></b>
              <span className="faint">against {ok ? `${fmt(n, n % 1 ? 4 : 0)} ${g!.collateral.symbol}` : "—"} · rate {best?.borrowApy === null || best?.borrowApy === undefined ? "—" : (best.borrowApy * 100).toFixed(2) + "% / yr"}</span>
            </div>

            <div className="sim-grid">
              <div className="card"><span className="lbl">Pool fees to your loan</span><b>{feesDay === null ? (pools === null ? <span className="faint" style={{ fontSize: 14 }}>reading the pool…</span> : "—") : usd(feesDay * 30, 2)}</b><span className="faint">a month, at the pool's pace over the last {pool?.volume?.hours ?? 6} h ({pool?.volume ? `${usd(pool.volume.volumeLoan, 0)} traded, ${pool.volume.swaps} swaps` : "no swaps seen"})</span></div>
              <div className="card"><span className="lbl">Interest</span><b>{ok ? usd(interestDay * 30, 2) : "—"}</b><span className="faint">a month, at today's lending rate</span></div>
              <div className="card"><span className="lbl">Loan pays itself off in</span><b className={netDay !== null && netDay > 0 ? "good" : ""}>{netDay === null ? "—" : span(days)}</b><span className="faint">{netDay !== null && netDay <= 0 ? "fees are lower than interest right now" : "if fees and rates stay as they are"}</span></div>
              <div className="card"><span className="lbl">Safety lines</span><b>{ok ? usd(protectAt) : "—"}</b><span className="faint">protection starts here · liquidation at {ok && liqAt ? usd(liqAt) : "—"} (price now {ok ? usd(price!) : "—"})</span></div>
            </div>

            <div className="card sim-whatif">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="lbl">What if {g?.collateral.symbol ?? "the stock"} moves</span>
                <b className={state === "liquidated" ? "bad" : state === "protecting" ? "warn" : ""}>{move > 0 ? "+" : ""}{move}% → {ok ? usd(moved) : "—"}</b>
              </div>
              <input type="range" min={-60} max={60} step={5} value={move} onChange={(e) => setMove(Number(e.target.value))} />
              <p style={{ margin: "8px 0 0", fontSize: 14 }}>
                {!ok ? "" : state === "fine"
                  ? <>Loan-to-value would be <b>{(ltvNow * 100).toFixed(0)}%</b>. Inside your limits; nothing happens, fees keep paying the loan down.</>
                  : state === "protecting"
                    ? <>Loan-to-value would be <b>{(ltvNow * 100).toFixed(0)}%</b>, past your {Math.round(P.trigger * 100)}% line. Auto-repay sells a little {g!.collateral.symbol} and pays the loan down first, before anyone can liquidate you.</>
                    : <>Loan-to-value would be <b>{(ltvNow * 100).toFixed(0)}%</b>, past the {Math.round(lltv * 100)}% liquidation line. Protection is meant to act well before this; a crash that fast is the risk you take.</>}
              </p>
            </div>

            <p className="note" style={{ marginTop: 14, fontSize: 13 }}>An estimate, not a promise. Fees depend on how much trading happens in the pool; on quiet days (weekends, holidays) they are near zero. The pool number is pool-wide; a position in a tight range earns more per dollar, out of range it earns nothing.</p>
            <div className="row" style={{ marginTop: 16 }}>
              <Link className="btn green lg" href={best ? `/borrow?market=${best.id}` : "/borrow"}>Open this loan<span className="arr">→</span></Link>
              <Link className="btn lg" href="/docs">How it works</Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
