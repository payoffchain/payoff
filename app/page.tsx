"use client";

import Link from "next/link";
import Nav from "./components/Nav";
import LoopDiagram from "./components/LoopDiagram";
import { CountUp, Reveal, Words } from "./components/motion";
import { useLive } from "./components/useLive";
import { APP, CHAIN_NAME, FACTORY } from "./components/brand";
import { Tok, pct } from "./components/ui";
import { usd } from "./components/format";

type Board = { live: boolean; groups: Array<{ collateral: { address: string; symbol: string; isStock: boolean }; best: { borrowApy: number | null; lltv: number; liquidityUsd: number } | null; rows: Array<{ totalSupplyUsd: number }> }> };
type Leader = { totals: { vaults: number; debtUsd: number; collateralUsd: number; repaidFromFeesUsd: number; harvestedUsd: number; refinances: number } };

const ICONS = {
  borrow: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10h18M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" /></svg>,
  deploy: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 18c3-8 6-8 8-4s5 4 8-6" /></svg>,
  repay: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" /></svg>,
  key: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M16 6l2 2M18 4l2 2" /></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" /></svg>,
  oracle: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  flash: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z" /></svg>,
  eye: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>,
  book: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4ZM20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8V4Z" /></svg>,
};

export default function Landing() {
  const board = useLive<Board>("/api/markets?stocks=1", { live: false, groups: [] });
  const lb = useLive<Leader>("/api/leaderboard", { totals: { vaults: 0, debtUsd: 0, collateralUsd: 0, repaidFromFeesUsd: 0, harvestedUsd: 0, refinances: 0 } }, !!FACTORY);
  const top = board.data?.groups.filter((g) => g.best).slice(0, 8) ?? [];
  const tickerItems = top.length ? top : [];
  const totalAvailable = top.reduce((a, g) => a + (g.best?.liquidityUsd ?? 0), 0);
  const marketCount = board.data?.groups.reduce((a, g) => a + g.rows.length, 0) ?? 0;

  return (
    <>
      <Nav />
      <main>
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <span className={"chip" + (FACTORY ? " live" : "")}><span className="dot" />{FACTORY ? `live on ${CHAIN_NAME}` : `built for ${CHAIN_NAME}`}</span>
              <h1>
                <Words text="Borrow against your stocks." base={80} />
                <br />
                <span className="hl"><Words text="Let the loan pay itself down." base={420} /></span>
              </h1>
              <p className="lede" style={{ animation: "fadeUp .8s .9s both" }}>
                Deposit tokenized stocks as collateral on Morpho, borrow USDG, and hand the loan to an agent you scope. It earns Uniswap V3 trading fees, pays them onto your debt, moves the debt when a cheaper market appears, and steps in before liquidation. The vault is yours; the agent's key cannot withdraw.
              </p>
              <div className="row" style={{ marginTop: 28, gap: 12, animation: "fadeUp .8s 1.1s both" }}>
                <Link className="btn coral lg" href="/deploy">Deploy an agent</Link>
                <Link className="btn lg" href="/rates">See the rates</Link>
                <Link className="btn lg" href="/docs">How it works</Link>
              </div>
              <div className="row faint mono" style={{ marginTop: 22, fontSize: 12, gap: 18, animation: "fadeUp .8s 1.3s both" }}>
                <span>Non-custodial</span><span>·</span><span>Morpho Blue + Uniswap V3</span><span>·</span><span>No fee to borrow or hop</span>
              </div>
            </div>
            <div style={{ animation: "fadeUp 1s .5s both" }}>
              <LoopDiagram symbol={top[1]?.collateral.symbol ?? "NVDA"} />
            </div>
          </div>
        </section>

        <div className="ticker" aria-hidden>
          <div className="track">
            {[0, 1].map((k) => (
              <span key={k} style={{ display: "inline-flex", gap: 40 }}>
                {tickerItems.length ? tickerItems.map((g) => (
                  <span key={g.collateral.address + k}>{g.collateral.symbol} borrow <b className="up">{pct(g.best!.borrowApy)}</b> · LLTV {(g.best!.lltv * 100).toFixed(0)}% · {usd(g.best!.liquidityUsd)} available</span>
                )) : <span>{board.loading ? "reading Morpho markets on Robinhood Chain…" : "Morpho rates unavailable right now"}</span>}
              </span>
            ))}
          </div>
        </div>

        <section style={{ padding: "56px 0" }}>
          <div className="wrap stats">
            <Reveal className="stat" delay={0}><span className="lbl">USDG markets on Morpho</span><span className="big"><CountUp value={marketCount} /></span><span className="faint" style={{ fontSize: 12 }}>{board.data?.groups.length ?? 0} stock collaterals</span></Reveal>
            <Reveal className="stat" delay={80}><span className="lbl">Available to borrow (top 8)</span><span className="big"><CountUp value={totalAvailable} format={(n) => usd(n)} /></span><span className="faint" style={{ fontSize: 12 }}>read on chain just now</span></Reveal>
            <Reveal className="stat" delay={160}><span className="lbl">{FACTORY ? "Vaults" : "Protocol fee to borrow"}</span><span className="big">{FACTORY ? <CountUp value={lb.data?.totals.vaults ?? 0} /> : "0%"}</span><span className="faint" style={{ fontSize: 12 }}>{FACTORY ? `${usd(lb.data?.totals.collateralUsd ?? 0)} collateral` : "and 0% to refinance"}</span></Reveal>
            <Reveal className="stat" delay={240}><span className="lbl">{FACTORY ? "Repaid from fees" : "Fee on harvested fees"}</span><span className="big green">{FACTORY ? <CountUp value={lb.data?.totals.repaidFromFeesUsd ?? 0} format={(n) => usd(n, 2)} /> : "2.5%"}</span><span className="faint" style={{ fontSize: 12 }}>{FACTORY ? "paid by agents so far" : "10% of profit at close, capped in code"}</span></Reveal>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">How it works</span><h2>Three steps from idle stock tokens to a loan that shrinks on its own.</h2></Reveal>
            <div className="grid g3" style={{ marginTop: 32 }}>
              {[
                { n: "01", ico: ICONS.borrow, t: "Collateral in Morpho, debt in USDG", p: `Your NVDA, TSLA, SPY or WETH goes into a Morpho Blue market under your own vault contract. You borrow USDG up to a ceiling you set — the market's liquidation threshold is further out.` },
                { n: "02", ico: ICONS.deploy, t: "The loan goes to work", p: `The agent puts the USDG into the Uniswap V3 pool of the same pair in a range around spot. Stock-token pools on ${CHAIN_NAME} turn over millions a day; that volume is fee income.` },
                { n: "03", ico: ICONS.repay, t: "Fees pay the debt", p: `Every harvest goes straight onto the loan. If another market of the same pair borrows cheaper, the debt moves there in one flash-loan transaction. If LTV crosses your trigger, the agent repays before Morpho can liquidate.` },
              ].map((c, i) => (
                <Reveal key={c.n} delay={i * 110} className="card feature">
                  <span className="num">{c.n}</span>
                  <div className="ico">{c.ico}</div>
                  <h3>{c.t}</h3>
                  <p>{c.p}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal>
              <span className="eyebrow">Live on Morpho · {CHAIN_NAME}</span>
              <h2>Where the cheapest USDG is today.</h2>
              <p className="lede">One collateral, several markets. Each has its own utilisation and its own rate — the spread between them is what the agent hops.</p>
            </Reveal>
            <Reveal delay={120} className="tblwrap card" style={{ marginTop: 28, padding: 6 }}>
              <table className="tbl">
                <thead><tr><th>Collateral</th><th className="r">Best borrow APY</th><th className="r">LLTV</th><th className="r">USDG available</th><th className="r">Markets</th><th></th></tr></thead>
                <tbody>
                  {top.map((g) => (
                    <tr key={g.collateral.address}>
                      <td><Tok symbol={g.collateral.symbol} /></td>
                      <td className="r green">{pct(g.best!.borrowApy)}</td>
                      <td className="r">{(g.best!.lltv * 100).toFixed(0)}%</td>
                      <td className="r">{usd(g.best!.liquidityUsd)}</td>
                      <td className="r">{g.rows.length}</td>
                      <td className="r"><Link className="btn xs" href={`/deploy`}>Borrow →</Link></td>
                    </tr>
                  ))}
                  {top.length === 0 && <tr><td colSpan={6} className="faint">{board.loading ? <span><span className="spinner" /> Reading markets…</span> : board.error ?? "No live market data."}</td></tr>}
                </tbody>
              </table>
            </Reveal>
            <div className="row" style={{ marginTop: 18 }}><Link className="btn sm" href="/rates">All markets →</Link></div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">Security model</span><h2>Two keys. One can take money out. It is yours.</h2></Reveal>
            <div className="grid g3" style={{ marginTop: 32 }}>
              {[
                { ico: ICONS.key, t: "Your vault, your owner key", p: "Every position lives in a contract only you own. Withdrawals go to the owner address and nowhere else. Pause, replace the operator, or change the policy any time." },
                { ico: ICONS.shield, t: "A scoped operator key", p: "The agent's key may borrow within your LTV ceiling, open and close liquidity in the vault's own pair, harvest into the debt, refinance into markets you allow-listed, and repay early. It cannot send tokens anywhere." },
                { ico: ICONS.oracle, t: "Oracle-policed prices", p: "Every swap gets a floor from the Morpho market oracle less your slippage setting, and every mint or burn checks the pool's spot price against the same oracle. A leaked key cannot sandwich the vault." },
                { ico: ICONS.flash, t: "Refinance in one transaction", p: "Moving debt uses Morpho's own flash loan: repay the old market, move the collateral, borrow in the new one, repay the flash loan. Either all of it happens or none of it." },
                { ico: ICONS.shield, t: "Liquidation protection", p: "You set a trigger LTV below the market's threshold and how much to repay when it is hit. The agent closes liquidity first and sells collateral only if it must — atomically, via flash loan." },
                { ico: ICONS.eye, t: "Open contracts, open brain", p: "The rules the agent follows are one readable file, and the plan it would execute right now is shown on every vault page before it happens. Every action lands on chain with its reason." },
              ].map((c, i) => (
                <Reveal key={c.t} delay={(i % 3) * 110} className="card feature">
                  <div className="ico">{c.ico}</div>
                  <h3>{c.t}</h3>
                  <p>{c.p}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal className="panel" style={{ padding: 40 }}>
              <span className="eyebrow" style={{ color: "var(--panel-green)" }}>Fees</span>
              <h2 style={{ color: "var(--panel-ink)" }}>Free to borrow, free to hop.<br />2.5% of harvested fees, 10% of realized profit.</h2>
              <p className="lede" style={{ color: "var(--panel-mute)" }}>Deployment, monitoring, refinancing and liquidation protection carry no protocol fee. On managed liquidity the protocol takes 2.5% of the trading fees it harvests and 10% of profit above cost when a position is closed at a gain — never on a loss. Both caps are in the vault's code; the factory owner cannot raise them.</p>
              <div className="row" style={{ marginTop: 28 }}><Link className="btn coral lg" href="/deploy">Deploy an agent</Link><Link className="btn lg" href="/docs" style={{ borderColor: "var(--panel-mute)", color: "var(--panel-ink)" }}>Read the docs</Link></div>
            </Reveal>
          </div>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <span>{APP} · self-repaying loans on {CHAIN_NAME} · Morpho Blue + Uniswap V3</span>
          <span className="row"><Link href="/docs">Docs</Link><Link href="/leaderboard">Leaderboard</Link><a href="/api/health">Status</a></span>
        </div>
      </footer>
    </>
  );
}
