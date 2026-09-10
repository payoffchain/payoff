"use client";

/**
 * The self-repaying loop, animated: stock tokens sit in a Morpho vault, USDG is borrowed
 * against them, the USDG earns fees in a Uniswap V3 pool, and the fees flow back onto
 * the debt, which shrinks. Pure SVG + CSS; nothing to load.
 */
export default function LoopDiagram({ symbol = "NVDA" }: { symbol?: string }) {
  return (
    <div className="loop" aria-hidden>
      <svg viewBox="0 0 560 400" width="100%" height="100%">
        <defs>
          <linearGradient id="lg-green" x1="0" x2="1"><stop offset="0" stopColor="#0c6b46" /><stop offset="1" stopColor="#3fb37f" /></linearGradient>
          <linearGradient id="lg-coral" x1="0" x2="1"><stop offset="0" stopColor="#f0654b" /><stop offset="1" stopColor="#ffb199" /></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        {/* paths */}
        <path id="p1" className="wire" d="M 120 100 C 200 100, 220 100, 280 100" />
        <path id="p2" className="wire" d="M 400 130 C 400 200, 400 210, 400 250" />
        <path id="p3" className="wire coral" d="M 340 290 C 220 290, 160 290, 130 200 C 115 160, 115 140, 120 128" />

        {/* moving dots */}
        {[0, 1.3, 2.6].map((d, i) => (
          <circle key={"a" + i} r="4" className="dot"><animateMotion dur="3.9s" begin={`${d}s`} repeatCount="indefinite"><mpath href="#p1" /></animateMotion></circle>
        ))}
        {[0.4, 1.7, 3].map((d, i) => (
          <circle key={"b" + i} r="4" className="dot"><animateMotion dur="3.9s" begin={`${d}s`} repeatCount="indefinite"><mpath href="#p2" /></animateMotion></circle>
        ))}
        {[0.8, 2.1, 3.4].map((d, i) => (
          <circle key={"c" + i} r="4" className="dot coral"><animateMotion dur="3.9s" begin={`${d}s`} repeatCount="indefinite"><mpath href="#p3" /></animateMotion></circle>
        ))}

        {/* node: collateral in Morpho */}
        <g className="node float-a">
          <rect x="20" y="60" width="110" height="80" rx="16" />
          <text x="75" y="88" className="t-l">{symbol}</text>
          <text x="75" y="106" className="t-s">in Morpho</text>
          <text x="75" y="124" className="t-xs">your vault</text>
        </g>

        {/* node: USDG borrowed */}
        <g className="node float-b">
          <rect x="280" y="60" width="240" height="70" rx="16" />
          <text x="400" y="88" className="t-l">USDG borrowed</text>
          <text x="400" y="110" className="t-s">up to your LTV ceiling</text>
        </g>

        {/* node: Uniswap pool */}
        <g className="node float-c">
          <rect x="280" y="250" width="240" height="80" rx="16" />
          <text x="400" y="278" className="t-l">{symbol}/USDG pool</text>
          <text x="400" y="298" className="t-s">Uniswap V3 · fees every swap</text>
          <text x="400" y="318" className="t-xs green">earning</text>
        </g>

        {/* debt bar */}
        <g className="node">
          <rect x="20" y="250" width="200" height="90" rx="16" />
          <text x="40" y="278" className="t-s" textAnchor="start">DEBT</text>
          <text x="200" y="278" className="t-s coral" textAnchor="end">fees → debt</text>
          <rect x="40" y="292" width="160" height="14" rx="7" className="track" />
          <rect x="40" y="292" width="160" height="14" rx="7" className="debt" />
          <text x="40" y="326" className="t-xs" textAnchor="start">shrinking on its own</text>
        </g>

        {/* label on coral wire */}
        <text x="230" y="360" className="t-xs coral">harvest → repay, every tick</text>
        <text x="200" y="88" className="t-xs">borrow</text>
        <text x="418" y="196" className="t-xs" textAnchor="start">deploy</text>
      </svg>
    </div>
  );
}
