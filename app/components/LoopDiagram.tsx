"use client";

/**
 * The self-repaying loop, animated: stock tokens sit in a Morpho vault, USDG is borrowed
 * against them, the USDG earns fees in a Uniswap V3 pool, and the fees flow back onto
 * the debt, which shrinks. Pure SVG + CSS; nothing to load.
 *
 * Layout (viewBox 560×420):
 *   [NVDA in Morpho]  ──borrow──▶  [USDG borrowed]
 *                                        │ deploy
 *   [DEBT ▮▮▮▯▯]  ◀── harvest → repay ── [NVDA/USDG pool]
 */
export default function LoopDiagram({ symbol = "NVDA" }: { symbol?: string }) {
  return (
    <div className="loop" aria-hidden>
      <svg viewBox="0 0 560 420" width="100%" height="100%">
        <defs>
          <linearGradient id="lg-green" x1="0" x2="1"><stop offset="0" stopColor="#22b87a" /><stop offset="1" stopColor="#3ddc97" /></linearGradient>
          <linearGradient id="lg-coral" x1="0" x2="1"><stop offset="0" stopColor="#ff6b4a" /><stop offset="1" stopColor="#ffb199" /></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        {/* wires: borrow (top), deploy (right, down), harvest → repay (bottom, back left, up into debt) */}
        <path id="p1" className="wire" d="M 172 100 L 278 100" />
        <path id="p2" className="wire" d="M 400 132 L 400 248" />
        <path id="p3" className="wire coral" d="M 400 332 C 400 372, 380 380, 340 380 L 160 380 C 130 380, 120 370, 120 344" />

        {[0, 1.3, 2.6].map((d, i) => (
          <circle key={"a" + i} r="4" className="dot"><animateMotion dur="3.9s" begin={`${d}s`} repeatCount="indefinite"><mpath href="#p1" /></animateMotion></circle>
        ))}
        {[0.4, 1.7, 3].map((d, i) => (
          <circle key={"b" + i} r="4" className="dot"><animateMotion dur="3.9s" begin={`${d}s`} repeatCount="indefinite"><mpath href="#p2" /></animateMotion></circle>
        ))}
        {[0.8, 2.1, 3.4].map((d, i) => (
          <circle key={"c" + i} r="4" className="dot coral"><animateMotion dur="5.2s" begin={`${d}s`} repeatCount="indefinite"><mpath href="#p3" /></animateMotion></circle>
        ))}

        {/* wire labels, kept clear of every box */}
        <text x="225" y="88" className="t-xs">borrow</text>
        <text x="412" y="196" className="t-xs" style={{ textAnchor: "start" }}>deploy</text>
        <text x="250" y="404" className="t-xs coral">harvest → repay, every tick</text>

        {/* node: collateral in Morpho */}
        <g className="node float-a">
          <rect x="20" y="60" width="150" height="80" rx="16" />
          <text x="95" y="90" className="t-l">{symbol}</text>
          <text x="95" y="108" className="t-s">in Morpho</text>
          <text x="95" y="126" className="t-xs">your vault</text>
        </g>

        {/* node: USDG borrowed */}
        <g className="node float-b">
          <rect x="280" y="60" width="240" height="72" rx="16" />
          <text x="400" y="90" className="t-l">USDG borrowed</text>
          <text x="400" y="112" className="t-s">up to your LTV ceiling</text>
        </g>

        {/* node: Uniswap pool */}
        <g className="node float-c">
          <rect x="280" y="250" width="240" height="82" rx="16" />
          <text x="400" y="278" className="t-l">{symbol}/USDG pool</text>
          <text x="400" y="298" className="t-s">Uniswap V3 · a fee on every swap</text>
          <text x="400" y="318" className="t-xs green">earning</text>
        </g>

        {/* node: debt bar */}
        <g className="node">
          <rect x="20" y="250" width="200" height="94" rx="16" />
          <text x="40" y="276" className="t-xs" style={{ textAnchor: "start" }}>debt</text>
          <text x="200" y="276" className="t-xs coral" style={{ textAnchor: "end" }}>fees → debt</text>
          <rect x="40" y="290" width="160" height="14" rx="7" className="track" />
          <rect x="40" y="290" width="160" height="14" rx="7" className="debt" />
          <text x="40" y="326" className="t-xs" style={{ textAnchor: "start" }}>shrinking on its own</text>
        </g>
      </svg>
    </div>
  );
}
