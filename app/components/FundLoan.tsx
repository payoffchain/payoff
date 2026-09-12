"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { useTx } from "./useTx";
import { useWallet } from "./WalletProvider";
import { TxLink } from "./ui";
import { usd } from "./format";

/**
 * The two signatures that make a freshly opened vault into a loan, right where the
 * vault was created: put the stock in, then borrow against it. Same API calls as the
 * vault page; this only saves the trip there. The borrow amount defaults to a bit
 * under the ceiling so a small price dip does not put the loan straight at its limit.
 */

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

export default function FundLoan({ vault, symbol, token, price, maxLtvBps, loanSymbol = "USDG" }: { vault: string; symbol: string; token: string; price: number | null; maxLtvBps: number; loanSymbol?: string }) {
  const w = useWallet();
  const tx = useTx();
  const [phase, setPhase] = useState<"deposit" | "borrow" | "done">("deposit");
  const [bal, setBal] = useState<{ amount: number; decimals: number } | null>(null);
  const [amt, setAmt] = useState("");
  const [deposited, setDeposited] = useState(0);
  const [share, setShare] = useState(80); // % of the ceiling to borrow
  const [borrowed, setBorrowed] = useState<string | null>(null);

  // wallet balance of the stock, so the amount box can offer "all"
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (!w.address || !(window as any).ethereum) return;
        const p = new ethers.BrowserProvider((window as any).ethereum);
        const c = new ethers.Contract(token, ERC20, p);
        const [raw, dec] = await Promise.all([c.balanceOf(w.address), c.decimals()]);
        if (!dead) setBal({ amount: Number(ethers.formatUnits(raw, dec)), decimals: Number(dec) });
      } catch { /* balance is a convenience only */ }
    })();
    return () => { dead = true; };
  }, [w.address, token, phase]);

  const amountOk = /^\d*\.?\d+$/.test(amt) && Number(amt) > 0 && (bal === null || Number(amt) <= bal.amount + 1e-12);
  const ceiling = price === null ? null : deposited * price * maxLtvBps / 10_000;
  const borrow = ceiling === null ? null : Math.floor(ceiling * share / 100 * 100) / 100;

  async function deposit() {
    const hash = await tx.run(`/api/vaults/${vault}/tx`, { action: "depositCollateral", amount: amt });
    if (!hash) return;
    setDeposited(Number(amt));
    setPhase("borrow");
  }
  async function doBorrow() {
    if (borrow === null || borrow <= 0) return;
    const hash = await tx.run(`/api/vaults/${vault}/tx`, { action: "borrow", amount: borrow.toFixed(2) });
    if (!hash) return;
    setBorrowed(borrow.toFixed(2));
    setPhase("done");
  }

  return (
    <div className="fund">
      {phase === "deposit" && (
        <>
          <h4>1 · Put your {symbol} in</h4>
          <p>It goes into Morpho under your vault's name. Only your wallet can take it back out.</p>
          <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Amount of {symbol}</label>
              <input inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value.trim())} />
              <span className="hint">
                {bal === null ? (w.address ? "reading your balance…" : "connect a wallet") : <>you have {bal.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbol}{bal.amount > 0 && <> · <button type="button" className="linkbtn" onClick={() => setAmt(String(bal.amount))}>use all</button></>}</>}
                {price !== null && amountOk ? ` · worth ${usd(Number(amt) * price)}` : ""}
              </span>
            </div>
            <button className="btn green" disabled={!amountOk || tx.busy} onClick={deposit}>{tx.busy ? tx.step : `Deposit ${symbol}`}</button>
          </div>
          {bal !== null && bal.amount === 0 && <p className="note" style={{ marginTop: 10 }}>This wallet holds no {symbol}. Buy some on Robinhood Chain first, or <Link href={`/vault/${vault}`} style={{ textDecoration: "underline" }}>open the vault page</Link> and come back later.</p>}
        </>
      )}

      {phase === "borrow" && (
        <>
          <h4>2 · Borrow {loanSymbol}</h4>
          <p>{deposited} {symbol} is in. Your ceiling is {ceiling === null ? "—" : usd(ceiling)} ({maxLtvBps / 100}% of its value). Borrowing a little under it leaves room for a bad day.</p>
          <div className="fund-slider">
            <input type="range" min={10} max={100} step={5} value={share} onChange={(e) => setShare(Number(e.target.value))} />
            <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }} >
              <span className="faint mono">{share}% of the ceiling</span>
              <b>{borrow === null ? "—" : `${usd(borrow)} ${loanSymbol}`}</b>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn green" disabled={borrow === null || borrow <= 0 || tx.busy} onClick={doBorrow}>{tx.busy ? tx.step : `Borrow ${borrow === null ? "" : usd(borrow)}`}</button>
            <button className="btn" disabled={tx.busy} onClick={() => setPhase("done")}>Skip for now</button>
          </div>
          {ceiling === null && <p className="note" style={{ marginTop: 10 }}>The price feed is closed right now (markets are shut), so the ceiling cannot be worked out. Come back to the vault page when they open.</p>}
        </>
      )}

      {phase === "done" && (
        <>
          <h4>✓ Your loan is set</h4>
          <p>{deposited > 0 ? `${deposited} ${symbol} in` : "Nothing deposited yet"}{borrowed ? `, ${usd(Number(borrowed))} ${loanSymbol} borrowed and waiting in the vault` : ""}. Auto-repay puts the {loanSymbol} into the pool, collects the fees and pays them onto the loan.</p>
          <div className="row" style={{ marginTop: 12 }}><Link className="btn green" href={`/vault/${vault}`}>Watch your loan<span className="arr">→</span></Link></div>
        </>
      )}

      {tx.error && <p className="note bad" style={{ marginTop: 10 }}>{tx.error}</p>}
      {tx.hash && tx.busy && <p className="note" style={{ marginTop: 10 }}>Waiting for confirmation… <TxLink hash={tx.hash} /></p>}
    </div>
  );
}
