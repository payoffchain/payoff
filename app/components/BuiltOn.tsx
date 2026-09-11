import { APP, CHAIN_NAME } from "./brand";

/**
 * The protocols this product is built on, with their marks. Logos live in
 * public/logos (Morpho, Uniswap and Chainlink from their public brand assets,
 * Robinhood from simple-icons); nothing loads from a third-party host at runtime.
 */
const STACK = [
  { name: CHAIN_NAME, sub: "the chain", src: "/logos/robinhood.svg", href: "https://chain.robinhood.com" },
  { name: "Morpho Blue", sub: "lending markets", src: "/logos/morpho.svg", href: "https://app.morpho.org" },
  { name: "Uniswap V3", sub: "liquidity & fees", src: "/logos/uniswap.svg", href: "https://app.uniswap.org" },
  { name: "Chainlink", sub: "price feeds", src: "/logos/chainlink.svg", href: "https://chain.link" },
];

export default function BuiltOn({ compact = false }: { compact?: boolean }) {
  return (
    <div className={"builton" + (compact ? " compact" : "")}>
      {!compact && <span className="builton-lbl">Built on</span>}
      <div className="builton-row">
        {STACK.map((s) => (
          <a key={s.name} className="builton-item" href={s.href} target="_blank" rel="noopener noreferrer" title={`${s.name}: ${s.sub}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="builton-logo"><img src={s.src} alt="" width={22} height={22} /></span>
            <span className="builton-name">{s.name}{!compact && <small>{s.sub}</small>}</span>
          </a>
        ))}
      </div>
      {!compact && <span className="builton-foot">{APP} · self-repaying loans · non-custodial</span>}
    </div>
  );
}
