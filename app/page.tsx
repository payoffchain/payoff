"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Nav from "./components/Nav";
import LoopDiagram from "./components/LoopDiagram";
import DemoPlayer from "./components/DemoPlayer";
import LoanTicket from "./components/LoanTicket";
import { CountUp, Reveal, Words } from "./components/motion";
import { useLive } from "./components/useLive";
import { APP, CHAIN_NAME, FACTORY, TWITTER, TWITTER_HANDLE, TOKEN_CA } from "./components/brand";
import { TokenLogo, pct } from "./components/ui";
import { usd } from "./components/format";

/**
 * Landing as a product, not a brochure: a short hero, the live ticker, then the market
 * grid people actually came for. The story (demo, how it works, security) follows.
 */

type Row = { id: string; lltv: number; borrowApy: number | null; liquidityUsd: number; totalSupplyUsd: number; collateralPrice?: number | null };
type Group = { collateral: { address: string; symbol: string; isStock: boolean; name: string | null }; best: Row | null; rows: Row[] };
type Board = { live: boolean; groups: Group[] };
type Pools = { collateral: { symbol: string }; hours: number; pools: Array<{ fee: number; tvlUsd: number | null; volume: { volumeLoan: number } | null }> };
type Leader = { totals: { vaults: number; debtUsd: number; collateralUsd: number; repaidFromFeesUsd: number; harvestedUsd: number; refinances: number } };

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";

const I = {
  key: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M16 6l2 2M18 4l2 2" /></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" /></svg>,
  oracle: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  flash: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z" /></svg>,
  eye: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>,
  life: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
};

/** Tilt the hero logo a few degrees toward the cursor; reset on leave. */
function tilt(e: React.MouseEvent<HTMLDivElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  const img = e.currentTarget.querySelector("img");
  if (img) { img.style.setProperty("--ry", `${x * 14}deg`); img.style.setProperty("--rx", `${-y * 14}deg`); }
}
function untilt(e: React.MouseEvent<HTMLDivElement>) {
  const img = e.currentTarget.querySelector("img");
  if (img) { img.style.setProperty("--ry", "0deg"); img.style.setProperty("--rx", "0deg"); }
}

export default function Landing() {
  const board = useLive<Board>("/api/markets", { live: false, groups: [] });
  const lb = useLive<Leader>("/api/leaderboard", { totals: { vaults: 0, debtUsd: 0, collateralUsd: 0, repaidFromFeesUsd: 0, harvestedUsd: 0, refinances: 0 } }, !!FACTORY);
  // The busiest stock pool on the chain, for the statement band. NVDA/USDG today; the
  // symbol shown comes from the API so a change of token needs only this address.
  const pools = useLive<Pools | null>(`/api/pools?collateral=${NVDA}&hours=6`, null);
  const [q, setQ] = useState("");
  const [stocksOnly, setStocksOnly] = useState(true);

  const groups = board.data?.groups ?? [];
  const vol = (() => {
    const d = pools.data;
    if (!d) return null;
    const busiest = d.pools.filter((p) => p.volume).sort((a, b) => (b.volume!.volumeLoan) - (a.volume!.volumeLoan))[0];
    return busiest && busiest.volume!.volumeLoan > 0 ? { symbol: d.collateral.symbol, hours: d.hours, volumeLoan: busiest.volume!.volumeLoan, fee: busiest.fee } : null;
  })();
  const withRate = groups.filter((g) => g.best);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withRate
      .filter((g) => !stocksOnly || g.collateral.isStock)
      .filter((g) => !needle || g.collateral.symbol.toLowerCase().includes(needle) || (g.collateral.name ?? "").toLowerCase().includes(needle))
      .slice(0, needle ? 48 : 12);
  }, [withRate, q, stocksOnly]);
  const ticker = withRate.filter((g) => g.collateral.isStock).slice(0, 10);
  const nvda = withRate.find((g) => g.collateral.address.toLowerCase() === NVDA.toLowerCase()) ?? null;
  const totalAvailable = withRate.reduce((a, g) => a + (g.best?.liquidityUsd ?? 0), 0);
  const marketCount = groups.reduce((a, g) => a + g.rows.length, 0);

  return (
    <>
      <Nav />
      <main>
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <div className="hero-logo" style={{ animation: "fadeUp 1s .2s both" }} onMouseMove={tilt} onMouseLeave={untilt}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/mark-c.png" alt={APP} width={512} height={512} /></div>
              <span className="chip"><span className="dot" />loan desk open</span>
              <h1>
                <Words text="Borrow against your stocks." base={80} />
                <br />
                <span className="hl"><Words text="Let the loan pay itself down." base={420} /></span>
              </h1>
              <p className="lede" style={{ animation: "fadeUp .8s .9s both" }}>
                Put tokenized stocks in as collateral, borrow USDG against them, and let the loan repay itself: the borrowed USDG earns trading fees in a Uniswap pool, and every fee goes onto your debt. Only you can take money out.
              </p>
              <div className="row" style={{ marginTop: 26, gap: 12, animation: "fadeUp .8s 1.1s both" }}>
                <Link className="btn green lg" href="/borrow">Open a loan<span className="arr">→</span></Link>
                <Link className="btn lg" href="/demo">▶ Watch the demo</Link>
              </div>
              <div className="row faint mono" style={{ marginTop: 22, fontSize: 12, gap: 18, animation: "fadeUp .8s 1.3s both" }}>
                <span>0% to borrow</span><span>·</span><span>0% to hop</span><span>·</span><span>2.5% of harvested fees</span>
              </div>
            </div>
            <div>
              <LoanTicket symbol={nvda?.collateral.symbol ?? "NVDA"} price={nvda?.best?.collateralPrice ?? 224.72} apy={nvda?.best?.borrowApy ?? 0.0003} />
            </div>
          </div>
        </section>

        <div className="ticker" aria-hidden>
          <div className="track">
            {[0, 1].map((k) => (
              <span key={k} style={{ display: "inline-flex", gap: 40 }}>
                {ticker.length ? ticker.map((g) => (
                  <span key={g.collateral.address + k}><b>{g.collateral.symbol}</b> borrow <span className="up">{pct(g.best!.borrowApy)}</span> · LLTV {(g.best!.lltv * 100).toFixed(0)}% · {usd(g.best!.liquidityUsd)} available</span>
                )) : <span>{board.loading ? "reading Morpho markets on Robinhood Chain…" : "Morpho rates unavailable right now"}</span>}
              </span>
            ))}
          </div>
        </div>

        <section>
          <div className="wrap band">
            <Reveal>
              <div className="huge">{vol ? usd(vol.volumeLoan) : "0%"}<small>{vol ? `traded in the ${vol.symbol}/USDG pool in the last ${vol.hours}h` : "to borrow. 0% to move markets. 0% to be protected."}</small></div>
            </Reveal>
            <Reveal delay={120}>
              <h2>{vol ? "Every one of those swaps paid a fee. That fee is what repays your loan." : "You pay nothing until the loan earns."}</h2>
              <p style={{ marginTop: 14 }}>
                {vol
                  ? <>Stock tokens on {CHAIN_NAME} trade around the clock, and the Uniswap pool takes <b>{(vol.fee / 10_000).toFixed(2)}%</b> of every swap for the people who put liquidity in. Your borrowed USDG becomes that liquidity. Its fees go straight onto your debt, every time they are collected, without you doing anything.</>
                  : <>Borrowing is free. Moving your debt to a cheaper market is free. Protection from liquidation is free. {APP} takes 2.5% of the trading fees the loan earns, and 10% of profit when a position closes in the green. Never on a loss.</>}
              </p>
            </Reveal>
          </div>
        </section>

        <section style={{ padding: "48px 0 72px" }}>
          <div className="wrap">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
              <div>
                <span className="eyebrow">Markets · Morpho Blue on {CHAIN_NAME}</span>
                <h2 style={{ marginTop: 10 }}>Pick a stock. Borrow USDG against it.</h2>
              </div>
              <div className="row faint mono" style={{ fontSize: 12, gap: 18 }}>
                <span><b className="green"><CountUp value={marketCount} /></b> markets</span>
                <span><b className="green"><CountUp value={totalAvailable} format={(n) => usd(n)} /></b> available</span>
                <span>{board.data?.live ? "on-chain, live" : board.loading ? "reading…" : "snapshot"}</span>
              </div>
            </div>

            <div className="mk-head">
              <label className="mk-search">
                {I.search}
                <input placeholder="Search a ticker…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
                <kbd>{shown.length}</kbd>
              </label>
              <div className="seg"><button className={stocksOnly ? "on" : ""} onClick={() => setStocksOnly(true)}>Stocks</button><button className={!stocksOnly ? "on" : ""} onClick={() => setStocksOnly(false)}>All collateral</button></div>
            </div>

            <div className="mk-grid">
              {shown.map((g, i) => (
                <Reveal key={g.collateral.address} delay={(i % 4) * 60} as={Link} className={"mk" + (i === 0 && !q ? " featured" : "")} href={`/borrow?market=${g.best!.id}`}>
                  <div className="top">
                    <span className="logo"><TokenLogo symbol={g.collateral.symbol} size={46} /></span>
                    <span className="id">
                      <span className="sym">{g.collateral.symbol}</span>
                      <span className="name">{g.collateral.name ?? (g.collateral.isStock ? "Robinhood Stock Token" : "collateral")}</span>
                    </span>
                    <span className={"tag " + (g.collateral.isStock ? "stock" : "")}>{g.collateral.isStock ? "stock" : "crypto"}</span>
                  </div>
                  <div className="rate">{pct(g.best!.borrowApy)}<small>borrow APY · best of {g.rows.length}</small></div>
                  <div className="meta">
                    <div><span>available</span><b>{usd(g.best!.liquidityUsd)}</b></div>
                    <div><span>LLTV</span><b>{(g.best!.lltv * 100).toFixed(0)}%</b></div>
                  </div>
                  <div className="cta"><span className="btn green go">Borrow USDG<span className="arr">→</span></span></div>
                </Reveal>
              ))}
              {shown.length === 0 && (
                <div className="mk-empty">{board.loading ? <span><span className="spinner" /> Reading markets on chain…</span> : q ? `No market matches "${q}".` : board.error ?? "No live market data right now."}</div>
              )}
              {shown.length > 0 && !q && <Link className="mk-more" href="/rates">All {marketCount} markets, every LLTV<span className="arr">→</span></Link>}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">Demo</span><h2>See it run, start to finish.</h2><p className="lede">Connect, pick a stock, choose how careful to be, open the loan, and watch it put the USDG to work, collect fees onto the debt and move to a cheaper market. Click to pause.</p></Reveal>
            <Reveal delay={120} style={{ marginTop: 28 }}><DemoPlayer /></Reveal>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">How it works</span><h2>Three moves, then the loan takes care of itself.</h2></Reveal>
            <Reveal delay={100} style={{ marginTop: 28, maxWidth: 640 }}><LoopDiagram symbol={ticker[1]?.collateral.symbol ?? "NVDA"} /></Reveal>
            <div className="desk3">
              {[
                { t: "deposit", n: "01", href: "/borrow", cta: "Open a loan ↗", p: "Put NVDA, TSLA, SPY or WETH into a vault contract only you own. It sits in a Morpho market under your vault's name and can leave only to your wallet." },
                { t: "borrow", n: "02", href: "/rates", cta: "See the rates ↗", p: "Borrow USDG against it, up to a ceiling you set. The USDG goes straight into the Uniswap pool for that stock, in a range around today's price." },
                { t: "earn", n: "03", href: "/docs", cta: "Read the docs ↗", p: "Every swap in the pool pays your range a fee. Each collection lands on the loan. A cheaper market appears? The debt moves. Price nears your line? It repays first." },
              ].map((s, i) => (
                <Reveal key={s.t} delay={i * 120} className="dcard"><span className="no">{s.n}</span><h3>{s.t}</h3><p>{s.p}</p><Link href={s.href}>{s.cta}</Link></Reveal>
              ))}
            </div>
            <div className="timeline" hidden>
              {[
                { t: "Collateral in, USDG out", p: `Your NVDA, TSLA, SPY or WETH goes into a Morpho Blue market under a vault contract only you own. You borrow USDG up to a ceiling you set; Morpho's liquidation line is further out.` },
                { t: "The loan goes to work", p: `Your USDG goes into the Uniswap V3 pool for that stock, in a range around today's price. Stock-token pools on ${CHAIN_NAME} turn over millions a day, and every swap pays the range a fee.` },
                { t: "Fees pay the debt", p: `Every fee collected goes straight onto the loan. A cheaper market for the same stock? The debt moves there in one transaction. Price falling toward your safety line? Part of the loan is repaid before Morpho could ever liquidate.` },
              ].map((s, i) => (
                <Reveal key={s.t} delay={i * 120} className="tstep"><span className="dot">0{i + 1}</span><h3>{s.t}</h3><p>{s.p}</p></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">Security model</span><h2>Only you can take money out.</h2></Reveal>
            <div className="bento" style={{ marginTop: 32 }}>
              <Reveal className="card feature b-3" delay={0}>
                <div className="ico">{I.key}</div>
                <h3>Your loan lives in a vault only you own</h3>
                <p>Every loan is its own small contract with you as the owner. Withdrawals go to your wallet and nowhere else. Turn auto-repay off, change the safety settings, or hand the vault to a new owner, any time.</p>
              </Reveal>
              <Reveal className="card feature b-3" delay={100}>
                <div className="ico">{I.shield}</div>
                <h3>Auto-repay can work, not withdraw</h3>
                <p>The part that repays your loan may put USDG into the pool, collect fees onto the debt, move the debt to a cheaper market, and repay early. It cannot send a token to any address. Even if its key leaked, nobody could steal from you.</p>
              </Reveal>
              <Reveal className="card feature b-2" delay={0}><div className="ico">{I.oracle}</div><h3>Oracle-policed prices</h3><p>Every swap must fill at the oracle price less the slippage you allow; the pool's price is checked against it too. No price, no trade.</p></Reveal>
              <Reveal className="card feature b-2" delay={100}><div className="ico">{I.flash}</div><h3>Atomic refinancing</h3><p>Morpho's own flash loan: repay the old market, move the collateral, borrow in the new one, repay the loan. All or nothing.</p></Reveal>
              <Reveal className="card feature b-2" delay={200}><div className="ico">{I.life}</div><h3>Liquidation protection</h3><p>Choose a safety line below where Morpho would liquidate. When the price gets there, part of the loan is repaid: from idle USDG first, then the pool position, and only then a slice of collateral.</p></Reveal>
              <Reveal className="card feature b-6" delay={0} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, alignItems: "center" }}>
                <div className="ico" style={{ marginBottom: 0 }}>{I.eye}</div>
                <div><h3>Nothing hidden</h3><p>The rules auto-repay follows are one readable file. What it will do next is shown on every loan page before it happens, with the reason. Every action lands on chain and in the activity log.</p></div>
              </Reveal>
            </div>
          </div>
        </section>

        {FACTORY && (
          <section style={{ padding: "40px 0 72px" }}>
            <div className="wrap stats">
              <Reveal className="stat" delay={0}><span className="lbl">Vaults</span><span className="big"><CountUp value={lb.data?.totals.vaults ?? 0} /></span><span className="faint" style={{ fontSize: 12 }}>{usd(lb.data?.totals.collateralUsd ?? 0)} collateral</span></Reveal>
              <Reveal className="stat" delay={80}><span className="lbl">Debt outstanding</span><span className="big"><CountUp value={lb.data?.totals.debtUsd ?? 0} format={(n) => usd(n)} /></span><span className="faint" style={{ fontSize: 12 }}>USDG across all vaults</span></Reveal>
              <Reveal className="stat" delay={160}><span className="lbl">Repaid from fees</span><span className="big green"><CountUp value={lb.data?.totals.repaidFromFeesUsd ?? 0} format={(n) => usd(n, 2)} /></span><span className="faint" style={{ fontSize: 12 }}>paid by the loans themselves</span></Reveal>
              <Reveal className="stat" delay={240}><span className="lbl">Refinances</span><span className="big"><CountUp value={lb.data?.totals.refinances ?? 0} /></span><span className="faint" style={{ fontSize: 12 }}>hops to a cheaper market</span></Reveal>
            </div>
          </section>
        )}

        <section>
          <div className="wrap">
            <Reveal className="cta">
              <span className="eyebrow">Get started</span>
              <h2>Put your idle stock tokens to work.</h2>
              <p className="lede">No minimum. No lock-in. Nothing to trust but a contract you own and can read.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="wm" src="/logo.png" alt="" aria-hidden />
              <div className="row" style={{ marginTop: 28 }}><Link className="btn green lg" href="/borrow">Open a loan<span className="arr">→</span></Link><Link className="btn lg" href="/docs">Read the docs</Link></div>
            </Reveal>
          </div>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <span className="links"><Link href="/docs">Docs</Link><Link href="/leaderboard">Leaderboard</Link><Link href="/demo">Demo</Link><a href="/api/health">Status</a>{TWITTER && <a href={TWITTER} target="_blank" rel="noopener noreferrer">{TWITTER_HANDLE}</a>}<span className="faint mono" style={{ fontSize: 12 }}>CA · {TOKEN_CA || "soon"}</span></span>
        </div>
      </footer>
    </>
  );
}
