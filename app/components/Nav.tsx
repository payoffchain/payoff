"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { EXPLORER } from "./format";
import { APP, CHAIN_NAME, FACTORY } from "./brand";
import SocialTags from "./SocialTags";

const ROUTES = [
  { href: "/app", label: "Dashboard" },
  { href: "/rates", label: "Rates" },
  { href: "/simulate", label: "Calculator" },
  { href: "/demo", label: "Demo" },
  { href: "/borrow", label: "Borrow" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/docs", label: "Docs" },
];

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

export default function Nav() {
  const path = usePathname();
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setOpen(false); setMenu(false); }, [path]);
  // the wallet menu closes on any click outside it or on Escape
  useEffect(() => {
    if (!menu) return;
    const off = (ev: MouseEvent) => { if (!(ev.target as Element | null)?.closest?.(".wmenu-wrap")) setMenu(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", key); };
  }, [menu]);
  const copy = async () => {
    if (!w.address) return;
    try { await navigator.clipboard.writeText(w.address); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  const disconnect = () => { setMenu(false); w.disconnect(); };
  const isOn = (href: string) => path === href || (href !== "/" && !!path?.startsWith(href + "/"));
  const label = w.wrongChain ? "Wrong network" : w.address ? short(w.address) : w.connecting ? "Loading…" : w.mode === "privy" ? "Log in" : "Connect wallet";
  const connected = !!w.address && !w.wrongChain;
  const action = w.wrongChain ? w.switchChain : connected ? () => setMenu((m) => !m) : w.connect;
  return (
    <nav className={"top" + (open ? " open" : "")}>
      <div className="wrap">
        <Link className="brand" href="/" aria-label={`${APP} home`}>
          <span className="mark">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/mark-64.png" alt="" width={30} height={30} /></span>
          {APP}
        </Link>
        <div className="navlinks">
          {ROUTES.map((r) => (
            <Link key={r.href} href={r.href} className={isOn(r.href) ? "on" : ""}><span>{r.label}</span><i className="ul" aria-hidden /></Link>
          ))}
        </div>
        <div className="navright">
          {!FACTORY && <span className="chip warn" title="Contracts not deployed yet"><span className="dot" />contracts pending</span>}
          <div className="wmenu-wrap">
            <button className={"btn sm " + (w.wrongChain ? "danger" : w.address ? "" : "green")} onClick={action} disabled={w.connecting} title={w.address ?? undefined} aria-haspopup={connected ? "menu" : undefined} aria-expanded={connected ? menu : undefined}>
              {connected && <span className="dot on" aria-hidden />}{label}{connected && <span className="caret" aria-hidden>▾</span>}
            </button>
            {connected && menu && (
              <div className="wmenu" role="menu">
                <div className="wmenu-addr mono">{w.address}</div>
                <button role="menuitem" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
                <a role="menuitem" href={`${EXPLORER}/address/${w.address}`} target="_blank" rel="noopener noreferrer">View on explorer ↗</a>
                <button role="menuitem" className="danger" onClick={disconnect}>Disconnect wallet</button>
              </div>
            )}
          </div>
        </div>
        <button className="navburger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><i /><i /><i /></button>
      </div>
      <div className="navsheet">
        {ROUTES.map((r) => <Link key={r.href} href={r.href}>{r.label}</Link>)}
        <SocialTags style={{ padding: "6px 0" }} />
        {connected ? (
          <div className="wsheet">
            <div className="mono faint" style={{ fontSize: 12 }}>Connected as {short(w.address!)}</div>
            <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
            <button className="btn danger" onClick={disconnect}>Disconnect wallet</button>
          </div>
        ) : (
          <button className="btn primary" onClick={action} disabled={w.connecting}>{label}</button>
        )}
      </div>
    </nav>
  );
}
