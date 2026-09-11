"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { APP, CHAIN_NAME, FACTORY, TWITTER } from "./brand";

const ROUTES = [
  { href: "/app", label: "Dashboard" },
  { href: "/rates", label: "Rates" },
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
  useEffect(() => setOpen(false), [path]);
  const isOn = (href: string) => path === href || (href !== "/" && !!path?.startsWith(href + "/"));
  const label = w.wrongChain ? "Wrong network" : w.address ? short(w.address) : w.connecting ? "Connecting…" : "Connect wallet";
  const action = w.wrongChain ? w.switchChain : w.address ? w.disconnect : w.connect;
  return (
    <nav className={"top" + (open ? " open" : "")}>
      <div className="wrap">
        <Link className="brand" href="/" aria-label={`${APP} home`}>
          <span className="mark">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/mark.png" alt="" width={30} height={30} /></span>
          {APP}
        </Link>
        <div className="navlinks">
          {ROUTES.map((r) => (
            <Link key={r.href} href={r.href} className={isOn(r.href) ? "on" : ""}>{r.label}</Link>
          ))}
        </div>
        <div className="navright">
          {!FACTORY && <span className="chip warn" title="Contracts not deployed yet"><span className="dot" />contracts pending</span>}
          {TWITTER && <a className="btn sm" href={TWITTER} target="_blank" rel="noopener noreferrer">X</a>}
          <button className={"btn sm " + (w.wrongChain ? "danger" : w.address ? "" : "green")} onClick={action} disabled={w.connecting} title={w.address ?? undefined}>{label}</button>
        </div>
        <button className="navburger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><i /><i /><i /></button>
      </div>
      <div className="navsheet">
        {ROUTES.map((r) => <Link key={r.href} href={r.href}>{r.label}</Link>)}
        <button className="btn primary" onClick={action} disabled={w.connecting}>{label}</button>
      </div>
    </nav>
  );
}
