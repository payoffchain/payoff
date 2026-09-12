"use client";

import { useEffect, useState } from "react";
import { txUrl } from "./format";

/**
 * The vault's life as a running log: what the contract did (from its events, newest
 * first) and what the site sees right now (price, loan-to-value, what auto-repay would
 * do next). Lines print one after another when they arrive, and a countdown shows when
 * the page reads the chain again. Nothing here is invented: every dated line has a
 * transaction behind it, and the "now" lines come from the same reads the page makes.
 */

export type LogEntry = { time: number | null; tx: string; type: string; title: string; detail: string; block: number };

type Now = {
  price: number | null;
  ltvBps: number | null;
  triggerBps: number;
  maxBps: number;
  paused: boolean;
  symbol: string;
  next: string | null; // what the next auto-repay step would be, in plain words; null when nothing is due
};

/** long addresses read as noise in a one-line log */
const shortAddr = (s: string) => s.replace(/0x[a-fA-F0-9]{40}/g, (m) => m.slice(0, 6) + "…" + m.slice(-4));
const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dm = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

/** Event titles are already plain; this only shortens a few for a one-line log. */
function tone(type: string): "good" | "bad" | "" {
  if (type === "Repaid" || type === "Harvested") return "good";
  if (type === "Protected" || type === "Paused") return "bad";
  return "";
}

export default function VaultLog({ entries, now, refreshedAt, every = 45 }: { entries: LogEntry[] | null; now: Now | null; refreshedAt: number; every?: number }) {
  const [shown, setShown] = useState(0);
  const [left, setLeft] = useState(every);

  // print lines one by one whenever a new batch arrives
  const rows = entries ? entries.slice(0, 14) : [];
  useEffect(() => {
    setShown(0);
    let i = 0;
    const id = setInterval(() => { i += 1; setShown(i); if (i >= rows.length) clearInterval(id); }, 90);
    return () => clearInterval(id);
  }, [refreshedAt, rows.length]);

  // countdown to the next read
  useEffect(() => {
    setLeft(every);
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [refreshedAt, every]);

  const ltv = now?.ltvBps === null || now?.ltvBps === undefined ? null : now.ltvBps / 100;
  const state = now === null ? null
    : now.paused ? { t: "auto-repay is off", c: "bad" }
    : ltv === null ? { t: "loan-to-value unknown (price feed closed)", c: "" }
    : now.ltvBps! >= now.triggerBps ? { t: "at the trigger line, protection is due", c: "bad" }
    : now.ltvBps! >= now.maxBps ? { t: "above your ceiling, no new borrowing", c: "" }
    : { t: "inside your limits", c: "good" };

  return (
    <div className="vlog" aria-live="polite">
      <div className="vlog-head">
        <span><i className="dot" />LOG · LIVE</span>
        <span>next read in {left}s</span>
      </div>
      <div className="vlog-now">
        {now ? (
          <>
            <div><span>NOW</span><b>{now.symbol} {now.price === null ? "price feed closed" : "$" + now.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b></div>
            <div><span>LTV</span><b className={state?.c}>{ltv === null ? "—" : ltv.toFixed(1) + "%"} · {state?.t}</b></div>
            <div><span>NEXT</span><b>{now.next ?? "nothing to do, waiting for fees"}</b></div>
          </>
        ) : <div><span>NOW</span><b className="faint">reading the chain…</b></div>}
      </div>
      <div className="vlog-lines">
        {entries === null && <div className="on faint"><span>—</span><span>reading events…</span></div>}
        {entries !== null && rows.length === 0 && <div className="on faint"><span>—</span><span>no activity yet. The first line appears when collateral goes in.</span></div>}
        {rows.map((e, i) => (
          <div key={e.tx + e.block + i} className={(i < shown ? "on " : "") + tone(e.type)}>
            <span title={e.time ? new Date(e.time * 1000).toLocaleString() : ""}>{e.time ? `${dm(e.time)} ${hhmm(e.time)}` : `#${e.block}`}</span>
            <span><b>{e.title}</b>{e.detail ? <em> · {shortAddr(e.detail)}</em> : null}</span>
            <a href={txUrl(e.tx)} target="_blank" rel="noopener noreferrer" title="open the transaction">↗</a>
          </div>
        ))}
        <div className="on cursor"><span>—</span><span>watching<i /></span></div>
      </div>
    </div>
  );
}
