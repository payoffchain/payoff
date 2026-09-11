"use client";

import Link from "next/link";
import Nav from "./components/Nav";
import LoopDiagram from "./components/LoopDiagram";
import DemoPlayer from "./components/DemoPlayer";
import { CountUp, Reveal, Words } from "./components/motion";
import { useLive } from "./components/useLive";
import { APP, CHAIN_NAME, FACTORY } from "./components/brand";
import { Tok, pct } from "./components/ui";
import { usd } from "./components/format";

type Board = { live: boolean; groups: Array<{ collateral: { address: string; symbol: string; isStock: boolean }; best: { borrowApy: number | null; lltv: number; liquidityUsd: number } | null; rows: Array<{ totalSupplyUsd: number }> }> };
type Leader = { totals: { vaults: number; debtUsd: number; collateralUsd: number; repaidFromFeesUsd: number; harvestedUsd: number; refinances: number } };

const I = {
  key: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M16 6l2 2M18 4l2 2" /></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" /></svg>,
  oracle: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  flash: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z" /></svg>,
  eye: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>,
  life: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" /></svg>,
};

export default function Landing() {
  const board = useLive<Board>("/api/markets?stocks=1", { live: false, groups: [] });
  const lb = useLive<Leader>("/api/leaderboard", { totals: { vaults: 0, debtUsd: 0, collateralUsd: 0, repaidFromFeesUsd: 0, harvestedUsd: 0, refinances: 0 } }, !!FACTORY);
  const top = board.data?.groups.filter((g) => g.best).slice(0, 8) ?? [];
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
                Tokenized stocks as collateral on Morpho, USDG borrowed against them, and an agent you scope that earns Uniswap V3 fees with the loan, pays them onto your debt, hops to cheaper markets and steps in before liquidation. The vault is yours. The agent's key cannot withdraw.
              </p>
              <div className="row" style={{ marginTop: 28, gap: 12, animation: "fadeUp .8s 1.1s both" }}>
                <Link className="btn coral lg" href="/deploy">Deploy an agent →</Link>
                <Link className="btn lg" href="/demo">▶ Watch the demo</Link>
              </div>
              <div className="row faint mono" style={{ marginTop: 26, fontSize: 12, gap: 18, animation: "fadeUp .8s 1.3s both" }}>
                <span>0% to borrow</span><span>·</span><span>0% to hop</span><span>·</span><span>2.5% of harvested fees</span>
              </div>
            </div>
            <div style={{ animation: "fadeUp 1s .5s both" }}>
              <LoopDiagram symbol={top[1]?.collateral.symbol ?? "NVDA"} />
              <div className="hero-card" style={{ marginTop: 18 }}>
                <div className="hd"><span>Cheapest USDG right now</span><span className="live">{board.data?.live ? "on-chain" : board.loading ? "reading" : "snapshot"}</span></div>
                <table className="mini">
                  <tbody>
                    {top.slice(0, 4).map((g) => (
                      <tr key={g.collateral.address}>
                        <td><Tok symbol={g.collateral.symbol} /></td>
                        <td className="r green">{pct(g.best!.borrowApy)}</td>
                        <td className="r faint">LLTV {(g.best!.lltv * 100).toFixed(0)}%</td>
                        <td className="r">{usd(g.best!.liquidityUsd)}</td>
                      </tr>
                    ))}
                    {top.length === 0 && <tr><td colSpan={4} className="faint">{board.loading ? "reading Morpho markets…" : "no live data"}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <div className="ticker" aria-hidden>
          <div className="track">
            {[0, 1].map((k) => (
              <span key={k} style={{ display: "inline-flex", gap: 40 }}>
                {top.length ? top.map((g) => (
                  <span key={g.collateral.address + k}>{g.collateral.symbol} borrow <b className="up">{pct(g.best!.borrowApy)}</b> · LLTV {(g.best!.lltv * 100).toFixed(0)}% · {usd(g.best!.liquidityUsd)} available</span>
                )) : <span>{board.loading ? "reading Morpho markets on Robinhood Chain…" : "Morpho rates unavailable right now"}</span>}
              </span>
            ))}
          </div>
        </div>

        <div className="wrap partners">
          <span><i />Morpho Blue</span><span><i />Uniswap V3</span><span><i />Chainlink oracles</span><span><i />Robinhood Stock Tokens</span><span><i />USDG</span>
        </div>

        <section style={{ padding: "40px 0 72px", borderTop: 0 }}>
          <div className="wrap bento">
            <Reveal className="card b-2" delay={0}><span className="lbl">USDG markets on Morpho</span><div className="big-number" style={{ marginTop: 10 }}><CountUp value={marketCount} /></div><p style={{ marginTop: 8 }}>{board.data?.groups.length ?? 0} stock collaterals, several LLTVs each — the spread the agent hops.</p></Reveal>
            <Reveal className="card b-2" delay={90}><span className="lbl">Available to borrow, top 8</span><div className="big-number g" style={{ marginTop: 10 }}><CountUp value={totalAvailable} format={(n) => usd(n)} /></div><p style={{ marginTop: 8 }}>Read on chain from each market's interest-rate model, not from an API.</p></Reveal>
            <Reveal className="card b-2" delay={180}><span className="lbl">{FACTORY ? "Repaid from fees, all vaults" : "Fee on trading fees harvested"}</span><div className="big-number g" style={{ marginTop: 10 }}>{FACTORY ? <CountUp value={lb.data?.totals.repaidFromFeesUsd ?? 0} format={(n) => usd(n, 2)} /> : "2.5%"}</div><p style={{ marginTop: 8 }}>{FACTORY ? `${lb.data?.totals.vaults ?? 0} vaults · ${usd(lb.data?.totals.collateralUsd ?? 0)} collateral` : "10% of realized profit at close. Both caps are in the vault's code."}</p></Reveal>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">Demo</span><h2>See it run, start to finish.</h2><p className="lede">Connect, pick a market, set the policy, create the vault, and watch the agent deploy the loan, harvest fees onto the debt and hop markets. Click to pause.</p></Reveal>
            <Reveal delay={120} style={{ marginTop: 28 }}><DemoPlayer /></Reveal>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">How it works</span><h2>Three moves, then the loan takes care of itself.</h2></Reveal>
            <div className="timeline">
              {[
                { t: "Collateral in, USDG out", p: `Your NVDA, TSLA, SPY or WETH goes into a Morpho Blue market under a vault contract only you own. You borrow USDG up to a ceiling you set; Morpho's liquidation line is further out.` },
                { t: "The loan goes to work", p: `The agent puts the USDG into the Uniswap V3 pool of the same pair, in a range around spot. Stock-token pools on ${CHAIN_NAME} turn over millions a day, and every swap pays the range a fee.` },
                { t: "Fees pay the debt", p: `Each harvest lands on the loan. A cheaper market of the same pair? The debt moves in one flash-loan transaction. LTV at your trigger? The agent repays before Morpho can liquidate.` },
              ].map((s, i) => (
                <Reveal key={s.t} delay={i * 120} className="tstep"><span className="dot">0{i + 1}</span><h3>{s.t}</h3><p>{s.p}</p></Reveal>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal><span className="eyebrow">Security model</span><h2>Two keys. Only yours can take money out.</h2></Reveal>
            <div className="bento" style={{ marginTop: 32 }}>
              <Reveal className="card feature b-3" delay={0}>
                <div className="ico">{I.key}</div>
                <h3>Your vault, your owner key</h3>
                <p>Every position lives in a contract only you own. Withdrawals go to the owner address and nowhere else. Pause the agent, replace its key, change the policy, hand the vault to a new owner in two steps — any time.</p>
              </Reveal>
              <Reveal className="card feature b-3" delay={100}>
                <div className="ico">{I.shield}</div>
                <h3>A scoped operator key</h3>
                <p>The agent may borrow within your LTV ceiling, open and close liquidity in the vault's own pair, harvest into the debt, refinance into markets you allow-listed and repay early. It cannot send a token to any address. A leaked key can trade badly inside the pair; it cannot steal.</p>
              </Reveal>
              <Reveal className="card feature b-2" delay={0}><div className="ico">{I.oracle}</div><h3>Oracle-policed prices</h3><p>Every swap is floored at the Morpho oracle less your slippage; every mint and burn checks the pool's spot price against it.</p></Reveal>
              <Reveal className="card feature b-2" delay={100}><div className="ico">{I.flash}</div><h3>Atomic refinancing</h3><p>Morpho's own flash loan: repay the old market, move the collateral, borrow in the new one, repay the loan. All or nothing.</p></Reveal>
              <Reveal className="card feature b-2" delay={200}><div className="ico">{I.life}</div><h3>Liquidation protection</h3><p>Set a trigger below the market's line and a repay share. Liquidity is closed first; collateral is sold only if it must be.</p></Reveal>
              <Reveal className="card feature b-6" delay={0} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, alignItems: "center" }}>
                <div className="ico" style={{ marginBottom: 0 }}>{I.eye}</div>
                <div><h3>Open contracts, open brain</h3><p>The rules the agent follows are one readable file. The plan it would sign right now is shown on every vault page, before it happens, with the reason for each action. Every action lands on chain and in the activity log.</p></div>
              </Reveal>
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <Reveal>
              <span className="eyebrow">Live on Morpho · {CHAIN_NAME}</span>
              <h2>Where the cheapest USDG is today.</h2>
            </Reveal>
            <Reveal delay={120} className="tblwrap card" style={{ marginTop: 28 }}>
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
                      <td className="r"><Link className="btn xs" href="/deploy">Borrow →</Link></td>
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
            <Reveal className="cta">
              <span className="eyebrow">Get started</span>
              <h2>Put your idle stock tokens to work.</h2>
              <p className="lede">No minimum. No lock-in. Nothing to trust but a contract you own and can read.</p>
              <div className="row" style={{ marginTop: 28 }}><Link className="btn coral lg" href="/deploy">Deploy an agent →</Link><Link className="btn lg" href="/docs">Read the docs</Link></div>
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
