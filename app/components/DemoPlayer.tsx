"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./motion";
import { APP, SITE_HOST } from "./brand";

/**
 * The product tour. With NEXT_PUBLIC_DEMO_VIDEO_URL set (YouTube, Loom, Vimeo or a
 * direct .mp4/.webm) it embeds that video. Otherwise it plays a scripted walkthrough:
 * eight scenes drawn from the real UI, auto-advancing like a video, with play/pause,
 * scrubbing, keyboard arrows and captions.
 *
 * EVERY WALLET, KEY AND TRANSACTION HASH BELOW IS ILLUSTRATIVE. The addresses were
 * generated for this file alone and were never funded or used; the private key row is
 * masked. Market ids and prices are real, because those are public and make the tour
 * honest about what the product actually reads.
 */

const VIDEO = (process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? "").trim();

function embedUrl(u: string): { kind: "iframe" | "video"; src: string } | null {
  try {
    const url = new URL(u);
    const h = url.hostname.replace(/^www\./, "");
    if (h === "youtube.com" || h === "m.youtube.com") {
      const id = url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean).pop();
      return id ? { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}?rel=0` } : null;
    }
    if (h === "youtu.be") return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}?rel=0` };
    if (h === "loom.com") return { kind: "iframe", src: u.replace("/share/", "/embed/") };
    if (h === "vimeo.com") return { kind: "iframe", src: `https://player.vimeo.com/video/${url.pathname.split("/").filter(Boolean).pop()}` };
    if (/\.(mp4|webm|mov)(\?|$)/i.test(url.pathname)) return { kind: "video", src: u };
    return { kind: "iframe", src: u };
  } catch {
    return null;
  }
}

type Scene = { title: string; caption: string; seconds: number; render: (t: number) => React.ReactNode };

const SCENES: Scene[] = [
  {
    title: "Connect your wallet",
    caption: "The wallet you connect will own the vault. It is the only address the vault ever pays out to.",
    seconds: 5,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-nav"><span className="dm-brand"><span className="mark">↓$</span>{APP}</span><span className={"dm-btn " + (t > 0.5 ? "done" : "")}>{t > 0.5 ? "0x4581…15f9" : "Connect wallet"}</span></div>
        <div className="dm-body">
          <div className="dm-h">Open a loan</div>
          <div className="dm-p">Borrow against your BTC. Let the loan pay itself down.</div>
          <div className={"dm-cursor " + (t > 0.3 && t < 0.55 ? "click" : "")} style={{ left: `${88 - Math.max(0, 0.5 - t) * 60}%`, top: `${8 + Math.max(0, 0.5 - t) * 60}%` }} />
          {t > 0.6 && <div className="dm-toast">Connected to Arc</div>}
        </div>
      </div>
    ),
  },
  {
    title: "Choose your collateral",
    caption: "cirBTC here, Circle's Bitcoin on Arc. The cheapest Morpho market with real liquidity is picked for you.",
    seconds: 6,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body">
          <div className="dm-h">Choose the collateral to borrow against</div>
          <table className="dm-tbl">
            <thead><tr><th></th><th>Market</th><th>LLTV</th><th>Borrow APY</th><th>Available</th></tr></thead>
            <tbody>
              {[["0xc2db905f…", "86.0%", "0.03%", "$147,968,038", true], ["0xabd17639…", "86.0%", "0.03%", "$100,238", false], ["0x4e4c5c1a…", "86.0%", "0.48%", "$989,140", false]].map((r, i) => (
                <tr key={i} className={i === 0 && t > 0.45 ? "sel" : ""}>
                  <td><span className={"dm-radio " + (i === 0 && t > 0.45 ? "on" : "")} /></td><td className="mono">{r[0]}</td><td>{r[1]}</td><td className="green">{r[2]}</td><td>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dm-tok" style={{ opacity: t > 0.15 ? 1 : 0 }}>cirBTC <span className="dm-faint">/ USDC</span></div>
          <div className={"dm-cursor " + (t > 0.4 && t < 0.5 ? "click" : "")} style={{ left: `${20 + Math.min(t, 0.45) * 30}%`, top: `${70 - Math.min(t, 0.45) * 40}%` }} />
        </div>
      </div>
    ),
  },
  {
    title: "Choose how careful to be",
    caption: "How much to borrow, and the price line where the loan starts repaying itself. Enforced by the contract, not by trust.",
    seconds: 6,
    render: (t) => {
      const k = Math.min(1, t * 1.6);
      const rows: Array<[string, number, string]> = [["Borrow ceiling", 45, "%"], ["Protect at", 55, "%"], ["Repay share", 25, "%"], ["Max slippage", 1, "%"]];
      return (
        <div className="dm-stage">
          <div className="dm-body">
            <div className="dm-h">How careful should the loan be?</div>
            <div className="dm-seg"><span>Careful</span><span className="on">Balanced</span><span>Bold</span></div>
            <div className="dm-grid">
              {rows.map(([l, v, u]) => (
                <div className="dm-field" key={l}><span className="dm-lbl">{l}</span><span className="dm-val">{(v * k).toFixed(l === "Max slippage" ? 1 : 0)}{u}</span><div className="dm-bar"><i style={{ width: `${Math.min(100, v * k * (l === "Max slippage" ? 20 : 1.4))}%` }} /></div></div>
              ))}
            </div>
            <div className="dm-note" style={{ opacity: t > 0.7 ? 1 : 0 }}>At $75,648 per cirBTC, 0.05 cirBTC lets you borrow up to $1,702 USDC. The loan starts repaying itself if BTC falls to $61,894. Morpho liquidates at $39,583.</div>
          </div>
        </div>
      );
    },
  },
  {
    title: "Set up auto-repay",
    caption: "A key made in your browser, shown once, never sent anywhere. It can work inside your limits; it cannot withdraw.",
    seconds: 5,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body">
          <div className="dm-h">Set up auto-repay</div>
          <div className={"dm-btn " + (t > 0.25 ? "done" : "")} style={{ display: "inline-block" }}>{t > 0.25 ? "Generated" : "Create the auto-repay key"}</div>
          <div className="dm-panel" style={{ opacity: t > 0.3 ? 1 : 0, transform: `translateY(${t > 0.3 ? 0 : 8}px)` }}>
            <div className="dm-kv"><span>Auto-repay address</span><b>0x443D…bDCB</b></div>
            <div className="dm-kv"><span>Private key</span><b>0x8e4f…•••• <span className="dm-faint">example</span></b></div>
            <div className="dm-faint" style={{ marginTop: 8 }}>Give it to the auto-repay program as AGENT_PRIVATE_KEY. Fund it with a little ETH for gas.</div>
            <div className="dm-check" style={{ opacity: t > 0.7 ? 1 : 0.4 }}><span className={"dm-radio sq " + (t > 0.7 ? "on" : "")} /> I have saved the private key somewhere safe.</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Open the loan, deposit, borrow",
    caption: "Three signatures from your wallet: open the loan, deposit 0.05 cirBTC, borrow 1,500 USDC.",
    seconds: 7,
    render: (t) => {
      const steps = [["Open loan", 0.15, "0xc88e…0c7c"], ["Deposit 0.05 cirBTC", 0.45, "0x12e7…10d7"], ["Borrow 1,500 USDC", 0.75, "0x4dc1…70d6"]] as const;
      return (
        <div className="dm-stage">
          <div className="dm-body">
            <div className="dm-h">Open the loan</div>
            {steps.map(([s, at, hash]) => (
              <div className="dm-tx" key={s}><span className={"dm-radio " + (t > at ? "on" : "")} /><span>{s}</span><span className="dm-faint mono">{t > at ? `confirmed · ${hash}` : t > at - 0.12 ? "signing…" : ""}</span></div>
            ))}
            <div className="dm-stats" style={{ opacity: t > 0.8 ? 1 : 0 }}>
              <div><span className="dm-lbl">Collateral</span><b>$3,782</b><small>0.05 cirBTC @ $75,648</small></div>
              <div><span className="dm-lbl">Debt</span><b>$60.00</b><small>LTV 13.4% · LLTV 63%</small></div>
              <div><span className="dm-lbl">Idle</span><b>1,500 USDC</b><small>about to go to work</small></div>
            </div>
          </div>
        </div>
      );
    },
  },
  {
    title: "The loan goes to work",
    caption: "Auto-repay sees 1,500 USDC idle and puts it into the cirBTC/USDC 0.3% pool, ±3% around today's price. It checks first, then signs.",
    seconds: 7,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body dm-term">
          <div><span className="green">$</span> payoff plan --vault 0xBaAb…eD28</div>
          {t > 0.15 && <div className="dm-faint">· protect: LTV 13.4% below trigger 55%</div>}
          {t > 0.3 && <div className="dm-faint">· refinance: no allow-listed market beats 0.03% by 30 bps</div>}
          {t > 0.45 && <div><span className="green">▶ open</span> 1,500.00 USDC idle → 0.3% pool (fee yield ≈ 24% APR), ±3% range</div>}
          {t > 0.65 && <div className="dm-faint">simulate ok · signing with operator 0x443D…bDCB</div>}
          {t > 0.85 && <div><span className="green">✓ confirmed</span> 0x4dc1…70d6 · position #1098779 in range $73,380 – $77,920</div>}
          <div className="dm-cur" />
        </div>
      </div>
    ),
  },
  {
    title: "Fees pay the debt",
    caption: "Every swap in the pool pays your range a fee. Each collection lands on the loan. The debt shrinks without you.",
    seconds: 8,
    render: (t) => {
      const debt = 60 - 60 * Math.min(1, t) * 0.62;
      const fees = 60 * Math.min(1, t) * 0.62;
      return (
        <div className="dm-stage">
          <div className="dm-body">
            <div className="dm-h">Position #1098779 · cirBTC/USDC 0.3%</div>
            <div className="dm-stats">
              <div><span className="dm-lbl">Debt</span><b>${debt.toFixed(2)}</b><small>was $60.00</small></div>
              <div><span className="dm-lbl">Repaid from fees</span><b className="green">${fees.toFixed(2)}</b><small>{Math.round(t * 41)} harvests</small></div>
              <div><span className="dm-lbl">Fee yield</span><b>69%</b><small>APR, pool-wide</small></div>
            </div>
            <div className="dm-lbl" style={{ marginTop: 14 }}>debt</div>
            <div className="dm-bar big"><i className="coral" style={{ width: `${(debt / 60) * 100}%` }} /></div>
            <div className="dm-log">
              {Array.from({ length: Math.min(4, Math.floor(t * 5)) }).map((_, i) => (
                <div key={i}><span className="dm-faint">{`0${9 + i}:${(12 + i * 7).toString().padStart(2, "0")}`}</span> Fees harvested · {(0.42 + i * 0.13).toFixed(2)} USDC + {(0.000006 + i * 0.000002).toFixed(6)} cirBTC → {(0.82 + i * 0.22).toFixed(2)} USDC to debt</div>
              ))}
            </div>
          </div>
        </div>
      );
    },
  },
  {
    title: "Move to a cheaper market, stay safe",
    caption: "A cheaper Morpho market for the same collateral? The debt moves there in one transaction. Price at your safety line? The loan repays part of itself first.",
    seconds: 7,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body">
          <div className="dm-h">What happens next</div>
          <div className="dm-card" style={{ opacity: t > 0.1 ? 1 : 0 }}>
            <div className="dm-row"><b>REFINANCE</b><span className="green mono">$0.42/yr</span></div>
            <div className="dm-faint">market 0xabd17639 borrows at 0.31% vs 0.75% here (saves 44 bps) · atomic via Morpho flash loan</div>
            <div className="dm-bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.min(100, Math.max(0, (t - 0.2) * 200))}%` }} /></div>
            {t > 0.7 && <div className="green" style={{ marginTop: 6 }}>✓ Refinanced · debt 1,500 → market 0xabd17639 · LTV 39.7%</div>}
          </div>
          <div className="dm-card" style={{ opacity: t > 0.55 ? 1 : 0.35 }}>
            <div className="dm-row"><b>PROTECT</b><span className="dm-faint mono">standing by</span></div>
            <div className="dm-faint">at the 55% safety line: repays 25% of the debt from idle USDC, then the pool position, then a slice of collateral, before Morpho could liquidate at 86%.</div>
          </div>
        </div>
      </div>
    ),
  },
];

export default function DemoPlayer({ compact = false }: { compact?: boolean }) {
  const reduced = useReducedMotion();
  const embed = VIDEO ? embedUrl(VIDEO) : null;
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const raf = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The preference resolves after the first render; honour it as soon as it does.
  useEffect(() => { if (reduced) setPlaying(false); }, [reduced]);
  const last = useRef(0);
  const total = SCENES.reduce((a, s) => a + s.seconds, 0);

  useEffect(() => {
    if (embed) return;
    if (!playing) { cancelAnimationFrame(raf.current); return; }
    last.current = performance.now();
    const step = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((cur) => {
        const next = cur + dt / SCENES[i].seconds;
        if (next >= 1) { setI((x) => (x + 1) % SCENES.length); return 0; }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, i, embed]);

  /**
   * Step by a delta, not to an absolute index: two arrow presses in the same frame both
   * read the same `i` from their closure, so an absolute jump loses the second press.
   */
  const step = useCallback((d: number) => { setI((cur) => ((cur + d) % SCENES.length + SCENES.length) % SCENES.length); setT(0); }, []);
  const go = useCallback((n: number) => { setI(((n % SCENES.length) + SCENES.length) % SCENES.length); setT(0); }, []);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    // Scoped to the player: Space must keep scrolling the page and activating buttons elsewhere.
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setPlaying((p) => !p); }
  }, [step]);

  if (embed) {
    return (
      <div className={"demo " + (compact ? "compact" : "")}>
        <div className="demo-frame">
          {embed.kind === "video" ? <video src={embed.src} controls playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <iframe src={embed.src} title={`${APP} demo`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}
        </div>
      </div>
    );
  }

  const elapsed = SCENES.slice(0, i).reduce((a, s) => a + s.seconds, 0) + t * SCENES[i].seconds;
  const scene = SCENES[i];
  return (
    <div ref={rootRef} className={"demo " + (compact ? "compact" : "")} onClick={() => setPlaying((p) => !p)} onKeyDown={onKey} tabIndex={0} role="group" aria-label="Product tour: Space plays or pauses, arrow keys step">
      {/* a browser window around the scenes, so the tour reads as a screen recording of the real site */}
      <div className="demo-chrome" aria-hidden><span className="dots"><i /><i /><i /></span><span className="url">{SITE_HOST}/{i === 0 ? "" : i < 5 ? "borrow" : "vault/0x443D…bDCB"}</span><span className="rec"><i />REC</span></div>
      <div className="demo-frame">
        <div className="demo-scene" key={i}>{scene.render(t)}</div>
        <div className="demo-caption"><span className="demo-step">{i + 1} / {SCENES.length}</span><b>{scene.title}</b><span>{scene.caption}</span></div>
        {!playing && <div className="demo-paused">▶</div>}
      </div>
      <div className="demo-bar" onClick={(e) => e.stopPropagation()}>
        <button className="demo-ctl" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <button className="demo-ctl" onClick={() => step(-1)} aria-label="Previous">‹</button>
        <div className="demo-track" onClick={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; let acc = 0; for (let k = 0; k < SCENES.length; k++) { if (f * total < acc + SCENES[k].seconds) { setI(k); setT((f * total - acc) / SCENES[k].seconds); return; } acc += SCENES[k].seconds; } }}>
          {SCENES.map((s, k) => <span key={k} className={"demo-seg " + (k < i ? "done" : k === i ? "cur" : "")} style={{ flex: s.seconds }}><i style={{ width: k < i ? "100%" : k === i ? `${t * 100}%` : 0 }} /></span>)}
        </div>
        <button className="demo-ctl" onClick={() => step(1)} aria-label="Next">›</button>
        <span className="demo-time mono">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")} / {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
