"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./motion";
import { APP } from "./brand";

/**
 * The product tour. With NEXT_PUBLIC_DEMO_VIDEO_URL set (YouTube, Loom, Vimeo or a
 * direct .mp4/.webm) it embeds that video. Otherwise it plays a scripted walkthrough:
 * eight scenes drawn from the real UI, auto-advancing like a video, with play/pause,
 * scrubbing, keyboard arrows and captions.
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
    title: "Connect the owner wallet",
    caption: "The wallet you connect will own the vault. It is the only address the vault ever pays out to.",
    seconds: 5,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-nav"><span className="dm-brand"><span className="mark">↓$</span>{APP}</span><span className={"dm-btn " + (t > 0.5 ? "done" : "")}>{t > 0.5 ? "0x7099…79C8" : "Connect wallet"}</span></div>
        <div className="dm-body">
          <div className="dm-h">Deploy an agent</div>
          <div className="dm-p">A vault only you can empty. An agent that can only make it shrink.</div>
          <div className={"dm-cursor " + (t > 0.3 && t < 0.55 ? "click" : "")} style={{ left: `${88 - Math.max(0, 0.5 - t) * 60}%`, top: `${8 + Math.max(0, 0.5 - t) * 60}%` }} />
          {t > 0.6 && <div className="dm-toast">Connected to Robinhood Chain</div>}
        </div>
      </div>
    ),
  },
  {
    title: "Pick the collateral and the Morpho market",
    caption: "One vault is one pair. NVDA against USDG here, in the market with the best rate and real liquidity.",
    seconds: 6,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body">
          <div className="dm-h">Pick the collateral and the market</div>
          <table className="dm-tbl">
            <thead><tr><th></th><th>Market</th><th>LLTV</th><th>Borrow APY</th><th>Available</th></tr></thead>
            <tbody>
              {[["0x66306c08…", "62.5%", "0.03%", "$13,089", true], ["0xbe3a5355…", "38.5%", "0.57%", "$100", false], ["0x3ce44383…", "86.0%", "0.28%", "$0", false]].map((r, i) => (
                <tr key={i} className={i === 0 && t > 0.45 ? "sel" : ""}>
                  <td><span className={"dm-radio " + (i === 0 && t > 0.45 ? "on" : "")} /></td><td className="mono">{r[0]}</td><td>{r[1]}</td><td className="green">{r[2]}</td><td>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dm-tok" style={{ opacity: t > 0.15 ? 1 : 0 }}>NVDA <span className="dm-faint">/ USDG</span></div>
          <div className={"dm-cursor " + (t > 0.4 && t < 0.5 ? "click" : "")} style={{ left: `${20 + Math.min(t, 0.45) * 30}%`, top: `${70 - Math.min(t, 0.45) * 40}%` }} />
        </div>
      </div>
    ),
  },
  {
    title: "Set the policy",
    caption: "Borrow ceiling, protection trigger, repay share, slippage. Enforced by the vault contract, not by trust.",
    seconds: 6,
    render: (t) => {
      const k = Math.min(1, t * 1.6);
      const rows: Array<[string, number, string]> = [["Borrow ceiling", 45, "%"], ["Protect at", 55, "%"], ["Repay share", 25, "%"], ["Max slippage", 1, "%"]];
      return (
        <div className="dm-stage">
          <div className="dm-body">
            <div className="dm-h">Set the policy</div>
            <div className="dm-seg"><span>Careful</span><span className="on">Balanced</span><span>Bold</span></div>
            <div className="dm-grid">
              {rows.map(([l, v, u]) => (
                <div className="dm-field" key={l}><span className="dm-lbl">{l}</span><span className="dm-val">{(v * k).toFixed(l === "Max slippage" ? 1 : 0)}{u}</span><div className="dm-bar"><i style={{ width: `${Math.min(100, v * k * (l === "Max slippage" ? 20 : 1.4))}%` }} /></div></div>
              ))}
            </div>
            <div className="dm-note" style={{ opacity: t > 0.7 ? 1 : 0 }}>At $224.72 per NVDA, 10 tokens let the agent borrow up to $1,011 USDG. Protection starts if NVDA falls to $183.86. Morpho liquidates at $161.80.</div>
          </div>
        </div>
      );
    },
  },
  {
    title: "Make the operator key",
    caption: "Generated in your browser, shown once, never sent anywhere. It can act inside the policy; it cannot withdraw.",
    seconds: 5,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body">
          <div className="dm-h">The operator key</div>
          <div className={"dm-btn " + (t > 0.25 ? "done" : "")} style={{ display: "inline-block" }}>{t > 0.25 ? "Generated" : "Generate operator key"}</div>
          <div className="dm-panel" style={{ opacity: t > 0.3 ? 1 : 0, transform: `translateY(${t > 0.3 ? 0 : 8}px)` }}>
            <div className="dm-kv"><span>Operator address</span><b>0x3C44…93BC</b></div>
            <div className="dm-kv"><span>Private key</span><b>0x5de4…365a</b></div>
            <div className="dm-faint" style={{ marginTop: 8 }}>Put it in the runner as AGENT_PRIVATE_KEY. Fund it with a little ETH for gas.</div>
            <div className="dm-check" style={{ opacity: t > 0.7 ? 1 : 0.4 }}><span className={"dm-radio sq " + (t > 0.7 ? "on" : "")} /> I have saved the private key somewhere safe.</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Create the vault, deposit, borrow",
    caption: "Three signatures from the owner wallet: create the vault, deposit 2 NVDA, borrow 60 USDG.",
    seconds: 7,
    render: (t) => {
      const steps = [["Create vault", 0.15], ["Deposit 2 NVDA", 0.45], ["Borrow 60 USDG", 0.75]] as const;
      return (
        <div className="dm-stage">
          <div className="dm-body">
            <div className="dm-h">Create the vault</div>
            {steps.map(([s, at]) => (
              <div className="dm-tx" key={s}><span className={"dm-radio " + (t > at ? "on" : "")} /><span>{s}</span><span className="dm-faint mono">{t > at ? "confirmed · 0x" + s.length.toString(16) + "f2a…" : t > at - 0.12 ? "signing…" : ""}</span></div>
            ))}
            <div className="dm-stats" style={{ opacity: t > 0.8 ? 1 : 0 }}>
              <div><span className="dm-lbl">Collateral</span><b>$449</b><small>2 NVDA @ $224.72</small></div>
              <div><span className="dm-lbl">Debt</span><b>$60.00</b><small>LTV 13.4% · LLTV 63%</small></div>
              <div><span className="dm-lbl">Idle</span><b>60 USDG</b><small>the agent deploys it</small></div>
            </div>
          </div>
        </div>
      );
    },
  },
  {
    title: "The agent deploys the loan",
    caption: "Next tick the runner reads the plan: 60 USDG idle → NVDA/USDG 0.05% pool, ±3% around spot. It simulates, then signs.",
    seconds: 7,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body dm-term">
          <div><span className="green">$</span> payoff plan --vault 0x5Ac7…10aC</div>
          {t > 0.15 && <div className="dm-faint">· protect: LTV 13.4% below trigger 55%</div>}
          {t > 0.3 && <div className="dm-faint">· refinance: no allow-listed market beats 0.03% by 30 bps</div>}
          {t > 0.45 && <div><span className="green">▶ open</span> 60.00 USDG idle → 0.05% pool (fee yield ≈ 69% APR on $7.7M TVL), ±3% range</div>}
          {t > 0.65 && <div className="dm-faint">simulate ok · signing with operator 0x3C44…93BC</div>}
          {t > 0.85 && <div><span className="green">✓ confirmed</span> 0xb927…ca10 · position #1098779 in range $218.10 – $231.60</div>}
          <div className="dm-cur" />
        </div>
      </div>
    ),
  },
  {
    title: "Fees pay the debt",
    caption: "Every swap in the pool pays the range a fee. Each harvest lands on the loan. The debt shrinks without you.",
    seconds: 8,
    render: (t) => {
      const debt = 60 - 60 * Math.min(1, t) * 0.62;
      const fees = 60 * Math.min(1, t) * 0.62;
      return (
        <div className="dm-stage">
          <div className="dm-body">
            <div className="dm-h">Position #1098779 · NVDA/USDG 0.05%</div>
            <div className="dm-stats">
              <div><span className="dm-lbl">Debt</span><b>${debt.toFixed(2)}</b><small>was $60.00</small></div>
              <div><span className="dm-lbl">Repaid from fees</span><b className="green">${fees.toFixed(2)}</b><small>{Math.round(t * 41)} harvests</small></div>
              <div><span className="dm-lbl">Fee yield</span><b>69%</b><small>APR, pool-wide</small></div>
            </div>
            <div className="dm-lbl" style={{ marginTop: 14 }}>debt</div>
            <div className="dm-bar big"><i className="coral" style={{ width: `${(debt / 60) * 100}%` }} /></div>
            <div className="dm-log">
              {Array.from({ length: Math.min(4, Math.floor(t * 5)) }).map((_, i) => (
                <div key={i}><span className="dm-faint">{`0${9 + i}:${(12 + i * 7).toString().padStart(2, "0")}`}</span> Fees harvested · {(0.42 + i * 0.13).toFixed(2)} USDG + {(0.0018 + i * 0.0004).toFixed(4)} NVDA → {(0.82 + i * 0.22).toFixed(2)} USDG to debt</div>
              ))}
            </div>
          </div>
        </div>
      );
    },
  },
  {
    title: "Hop to a cheaper market, stay safe",
    caption: "A cheaper Morpho market of the same pair? The debt moves in one flash-loan transaction. LTV at your trigger? The agent repays first.",
    seconds: 7,
    render: (t) => (
      <div className="dm-stage">
        <div className="dm-body">
          <div className="dm-h">What the agent would do</div>
          <div className="dm-card" style={{ opacity: t > 0.1 ? 1 : 0 }}>
            <div className="dm-row"><b>REFINANCE</b><span className="green mono">$0.42/yr</span></div>
            <div className="dm-faint">market 0xbe3a5355 borrows at 0.31% vs 0.75% here (saves 44 bps) · atomic via Morpho flash loan</div>
            <div className="dm-bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.min(100, Math.max(0, (t - 0.2) * 200))}%` }} /></div>
            {t > 0.7 && <div className="green" style={{ marginTop: 6 }}>✓ Refinanced · debt 60 → market 0xbe3a5355 · LTV 13.4%</div>}
          </div>
          <div className="dm-card" style={{ opacity: t > 0.55 ? 1 : 0.35 }}>
            <div className="dm-row"><b>PROTECT</b><span className="dm-faint mono">standing by</span></div>
            <div className="dm-faint">fires at LTV 55%: repays 25% of the debt from idle USDG, then positions, then collateral — before Morpho can liquidate at 63%.</div>
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
  const [playing, setPlaying] = useState(!reduced);
  const raf = useRef(0);
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

  const go = useCallback((n: number) => { setI(((n % SCENES.length) + SCENES.length) % SCENES.length); setT(0); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") go(i + 1); if (e.key === "ArrowLeft") go(i - 1); if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

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
    <div className={"demo " + (compact ? "compact" : "")} onClick={() => setPlaying((p) => !p)} role="group" aria-label="Product tour">
      <div className="demo-frame">
        <div className="demo-scene" key={i}>{scene.render(t)}</div>
        <div className="demo-caption"><span className="demo-step">{i + 1} / {SCENES.length}</span><b>{scene.title}</b><span>{scene.caption}</span></div>
        {!playing && <div className="demo-paused">▶</div>}
      </div>
      <div className="demo-bar" onClick={(e) => e.stopPropagation()}>
        <button className="demo-ctl" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <button className="demo-ctl" onClick={() => go(i - 1)} aria-label="Previous">‹</button>
        <div className="demo-track" onClick={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; let acc = 0; for (let k = 0; k < SCENES.length; k++) { if (f * total < acc + SCENES[k].seconds) { setI(k); setT((f * total - acc) / SCENES[k].seconds); return; } acc += SCENES[k].seconds; } }}>
          {SCENES.map((s, k) => <span key={k} className={"demo-seg " + (k < i ? "done" : k === i ? "cur" : "")} style={{ flex: s.seconds }}><i style={{ width: k < i ? "100%" : k === i ? `${t * 100}%` : 0 }} /></span>)}
        </div>
        <button className="demo-ctl" onClick={() => go(i + 1)} aria-label="Next">›</button>
        <span className="demo-time mono">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")} / {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
