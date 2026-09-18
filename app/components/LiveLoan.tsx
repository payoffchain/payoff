"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { APP, FEATURED_VAULT } from "./brand";
import LoanTicket from "./LoanTicket";
import { txUrl } from "./format";

/**
 * The hero ticket, fed by a real vault when one is featured (NEXT_PUBLIC_FEATURED_VAULT).
 * Every number is read from the chain through the same API the vault page uses, and
 * every fee line links to its transaction. If the featured vault has no loan yet, or
 * cannot be read, the worked example is shown instead, labelled as such.
 */
type Vault = {
  address: string; paused: boolean;
  collateral: { symbol: string }; loan: { symbol: string };
  market: { borrowApy: number | null };
  position: { collateral: number; debt: number; collateralPrice: number | null; ltv: number | null };
  stats: { totalBorrowed: number; totalRepaidFromFees: number; totalHarvested: number };
  lp: unknown[];
};
type Entry = { time: number | null; tx: string; type: string; args: Record<string, string> };

const usd = (n: number, d = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function LiveLoan(props: { symbol?: string; price?: number; apy?: number }) {
  const [v, setV] = useState<Vault | null>(null);
  const [fees, setFees] = useState<Entry[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!FEATURED_VAULT) return;
    let dead = false;
    fetch(`/api/vaults/${FEATURED_VAULT}`).then((r) => r.json()).then((j) => { if (!dead && j && !j.error) setV(j); }).catch(() => {});
    fetch(`/api/vaults/${FEATURED_VAULT}/activity?limit=60`).then((r) => r.json()).then((j) => {
      if (dead || !j?.entries) return;
      // one line per repayment out of fees, newest first, as the contract reported it
      setFees((j.entries as Entry[]).filter((e) => e.type === "Repaid" && e.args?.source === "fees").slice(0, 5));
    }).catch(() => {});
    const id = setInterval(() => setTick((t) => t + 1), 45_000);
    return () => { dead = true; clearInterval(id); };
  }, [tick]);

  // not featured, unreadable, or not a loan yet: the worked example
  if (!FEATURED_VAULT || !v || v.position.collateral === 0) return <LoanTicket {...props} />;

  const price = v.position.collateralPrice;
  const stage = v.position.debt === 0 ? 1 : v.lp.length === 0 && v.stats.totalRepaidFromFees === 0 ? 2 : 3;
  const short = v.address.slice(0, 6) + "…" + v.address.slice(-4);

  return (
    <div className="ticket live" aria-label="A live self-repaying loan">
      <div className="tk-head"><span>{APP} · LOAN STATEMENT</span><span><i className="dot" />LIVE</span></div>
      <div className="tk-steps">
        {["DEPOSITED", "BORROWED", "EARNING", "REPAID"].map((s, i) => <span key={s} className={i < stage ? "done" : i === stage ? "cur" : ""}>{s}</span>)}
      </div>
      <div className="tk-rows">
        <div><span>TICKER</span><b>{v.collateral.symbol}</b></div>
        <div><span>COLLATERAL</span><b>{v.position.collateral.toLocaleString("en-US", { maximumFractionDigits: 4 })} <small>{price === null ? "price feed closed" : `@ ${usd(price)}`}</small></b></div>
        <div><span>BORROWED</span><b>{usd(v.stats.totalBorrowed, 0)} {v.loan.symbol}</b></div>
        <div><span>RATE</span><b>{v.market.borrowApy === null ? "—" : (v.market.borrowApy * 100).toFixed(2) + "%"} <small>/ YR</small></b></div>
        <div><span>DEBT NOW</span><b className="tk-debt">{usd(v.position.debt)}</b></div>
      </div>
      <div className="tk-sub"><span>FEES COLLECTED</span><span>{usd(v.stats.totalRepaidFromFees)} → DEBT</span></div>
      <div className="tk-log">
        {fees === null && <div className="on faint"><span>—</span><span>reading the chain…</span><b /></div>}
        {fees !== null && fees.length === 0 && <div className="on faint"><span>—</span><span>{v.paused ? "auto-repay is off" : v.lp.length === 0 ? "USDG waiting to be put to work" : "waiting for the next swap"}</span><b /></div>}
        {(fees ?? []).map((f) => (
          <div key={f.tx} className="on">
            <span>{f.time ? hhmm(f.time) : "—"}</span>
            <span><a href={txUrl(f.tx)} target="_blank" rel="noopener noreferrer">pool fee ↗</a></span>
            <b>−{(Number(f.args.amount) / 1e6).toFixed(2)}</b>
          </div>
        ))}
      </div>
      <div className="tk-foot">A REAL LOAN ON ROBINHOOD CHAIN · <Link href={`/vault/${v.address}`}>VAULT {short} ↗</Link></div>
    </div>
  );
}
