"use client";

import { useEffect, useState } from "react";
import { APP } from "./brand";

/**
 * A loan, laid out like a desk ticket: status strip, the numbers, the fee log.
 * Live rate and price come from the market board when available; the amounts are a
 * worked example and say so. Fee lines "print" one after another while it is on
 * screen, so the thing the product promises (debt going down on its own) is visible
 * without reading a word.
 */
export default function LoanTicket({ symbol = "cirBTC", price = 75_648, apy = 0.0003 }: { symbol?: string; price?: number; apy?: number }) {
  const collateral = 0.05;
  const borrowed = Math.round(collateral * price * 0.45);
  const fees = [
    { t: "09:12", amt: 0.84 }, { t: "10:41", amt: 1.12 }, { t: "12:03", amt: 0.67 }, { t: "13:55", amt: 1.38 }, { t: "15:20", amt: 0.91 },
  ];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setShown((s) => (s >= fees.length ? 0 : s + 1)), 1600);
    return () => clearInterval(id);
  }, [fees.length]);
  const repaid = fees.slice(0, shown).reduce((a, f) => a + f.amt, 0);
  const debt = borrowed - repaid;
  const stage = shown === 0 ? 2 : 3;
  const usd = (n: number, d = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  return (
    <div className="ticket" aria-label="Worked example of a self-repaying loan">
      <div className="tk-head"><span>{APP} · LOAN STATEMENT</span><span>NO. 0001</span></div>
      <div className="tk-steps">
        {["DEPOSITED", "BORROWED", "EARNING", "REPAID"].map((s, i) => <span key={s} className={i < stage ? "done" : i === stage ? "cur" : ""}>{s}</span>)}
      </div>
      <div className="tk-rows">
        <div><span>TICKER</span><b>{symbol}</b></div>
        <div><span>COLLATERAL</span><b>{collateral.toFixed(2)} <small>@ {usd(price)}</small></b></div>
        <div><span>BORROWED</span><b>{usd(borrowed, 0)} USDC</b></div>
        <div><span>RATE</span><b>{(apy * 100).toFixed(2)}% <small>/ YR</small></b></div>
        <div><span>DEBT NOW</span><b className="tk-debt">{usd(debt)}</b></div>
      </div>
      <div className="tk-sub"><span>FEES COLLECTED</span><span>USDC → DEBT</span></div>
      <div className="tk-log">
        {fees.map((f, i) => (
          <div key={f.t} className={i < shown ? "on" : ""}><span>{f.t}</span><span>pool fee</span><b>−{f.amt.toFixed(2)}</b></div>
        ))}
        {shown === 0 && <div className="on faint"><span>—</span><span>waiting for the next swap</span><b /></div>}
      </div>
      <div className="tk-foot">REPAYS ITSELF · ONLY YOU CAN WITHDRAW · WORKED EXAMPLE, NOT A LIVE LOAN</div>
    </div>
  );
}
