"use client";

import { useEffect, useState } from "react";
import { HOSTED_STATUS_URL } from "./brand";

/**
 * One line that says whether PAYOFF's auto-repay program is up, read from its public
 * /health. Shown where people choose who runs auto-repay, so "PAYOFF runs it" is a
 * claim they can see is true right now. Fails quiet: no URL, or no answer, no line.
 */
type Health = { ok: boolean; dryRun: boolean; lastTick: string | null; vaults: string[]; lowGas: boolean };

export default function HostedStatus() {
  const [h, setH] = useState<Health | null | "down">(null);
  useEffect(() => {
    if (!HOSTED_STATUS_URL) return;
    let dead = false;
    const read = () => fetch(`${HOSTED_STATUS_URL}/health`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!dead) setH(j); }).catch(() => { if (!dead) setH("down"); });
    read();
    const id = setInterval(read, 30_000);
    return () => { dead = true; clearInterval(id); };
  }, []);
  if (!HOSTED_STATUS_URL || h === null) return null;
  if (h === "down") return <p className="hosted-status off"><i />status unavailable right now</p>;
  const mins = h.lastTick ? Math.max(0, Math.round((Date.now() - new Date(h.lastTick).getTime()) / 60_000)) : null;
  return (
    <p className={"hosted-status " + (h.ok ? "on" : "off")}>
      <i />{h.ok ? "online" : "needs attention"}{mins !== null ? ` · last check ${mins === 0 ? "just now" : mins + " min ago"}` : ""} · watching {h.vaults.length} vault{h.vaults.length === 1 ? "" : "s"}{h.dryRun ? " · warming up (watch only)" : ""}
    </p>
  );
}
