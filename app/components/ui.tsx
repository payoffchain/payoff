"use client";

import { useState } from "react";
import { EXPLORER } from "./format";

/** Small shared pieces. */

export function TokenLogo({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const s = symbol.toUpperCase();
  if (failed) return <span className="mono-logo" style={{ width: size, height: size }}>{s.slice(0, 4)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/logo/${encodeURIComponent(s)}`} alt="" width={size} height={size} onError={() => setFailed(true)} />;
}

export function Tok({ symbol, name }: { symbol: string; name?: string | null }) {
  return (
    <span className="tok">
      <TokenLogo symbol={symbol} />
      <span>{symbol}{name ? <span className="faint" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{name}</span> : null}</span>
    </span>
  );
}

export const pct = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : (x * 100).toFixed(d) + "%");
export const bps = (x: number | null | undefined) => (x === null || x === undefined ? "—" : (x / 100).toFixed(1) + "%");

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "green" | "red" | "amber" }) {
  return (
    <div className="stat">
      <span className="lbl">{label}</span>
      <span className={"big " + (tone ?? "")}>{value}</span>
      {sub ? <span className="faint" style={{ fontSize: 12 }}>{sub}</span> : null}
    </div>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: React.ReactNode }) {
  return <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ textDecoration: "underline" }}>{children ?? hash.slice(0, 10) + "…"}</a>;
}

export function AddrLink({ address, children }: { address: string; children?: React.ReactNode }) {
  return <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ textDecoration: "underline" }}>{children ?? address.slice(0, 6) + "…" + address.slice(-4)}</a>;
}

export function LtvBar({ ltv, max, trigger, lltv }: { ltv: number | null; max: number; trigger: number; lltv: number }) {
  const v = ltv ?? 0;
  const tone = ltv === null ? "bad" : v >= trigger ? "bad" : v >= max ? "warn" : "";
  return (
    <div>
      <div className={"bar " + tone}><i style={{ width: `${Math.min(100, (v / lltv) * 100)}%` }} /></div>
      <div className="row mono faint" style={{ fontSize: 11, justifyContent: "space-between", marginTop: 4 }}>
        <span>LTV {ltv === null ? "—" : (v * 100).toFixed(1) + "%"}</span>
        <span>ceiling {(max * 100).toFixed(0)}% · trigger {(trigger * 100).toFixed(0)}% · liquidation {(lltv * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/** Half-circle LTV gauge: the arc fills to the current LTV, with ticks at the ceiling, trigger and liquidation. */
export function Gauge({ ltv, max, trigger, lltv }: { ltv: number | null; max: number; trigger: number; lltv: number }) {
  const R = 80, C = Math.PI * R; // half circumference
  const v = ltv === null ? 0 : Math.min(ltv, lltv);
  const frac = lltv > 0 ? v / lltv : 0;
  const tone = ltv === null ? "var(--red)" : ltv >= trigger ? "var(--red)" : ltv >= max ? "var(--amber)" : "var(--green)";
  const tick = (f: number, cls: string) => {
    const a = Math.PI * (1 - f);
    const x1 = 100 + (R - 12) * Math.cos(a), y1 = 92 - (R - 12) * Math.sin(a);
    const x2 = 100 + (R + 12) * Math.cos(a), y2 = 92 - (R + 12) * Math.sin(a);
    return <line key={cls + f} className={cls} x1={x1} y1={y1} x2={x2} y2={y2} />;
  };
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 100">
        <defs><linearGradient id="lg-gauge" x1="0" x2="1"><stop offset="0" stopColor="#0c6b46" /><stop offset=".6" stopColor="#d9b071" /><stop offset="1" stopColor="#a33f36" /></linearGradient></defs>
        <path className="arc" d={`M 20 92 A ${R} ${R} 0 0 1 180 92`} />
        <path className="val" d={`M 20 92 A ${R} ${R} 0 0 1 180 92`} style={{ stroke: tone, strokeDasharray: `${C * frac} ${C}` }} />
        <g className="marks">{tick(max / lltv, "max")}{tick(trigger / lltv, "trig")}{tick(1, "liq")}</g>
      </svg>
      <div className="num">{ltv === null ? "—" : (ltv * 100).toFixed(1) + "%"}<small>loan to value</small></div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card soft" style={{ textAlign: "center", padding: 40 }}><p>{children}</p></div>;
}

export function DataBanner({ live, loading, error, what }: { live: boolean; loading: boolean; error: string | null; what: string }) {
  if (live) return null;
  return (
    <div className="banner">
      <div className="wrap">{loading ? `Loading ${what}…` : error ? `${what}: ${error}` : `${what}: not live`}</div>
    </div>
  );
}
