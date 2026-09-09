"use client";

import Link from "next/link";
import Nav from "./components/Nav";
import { useLive } from "./components/useLive";
import { APP, CHAIN_NAME, FACTORY } from "./components/brand";
import { Tok, pct } from "./components/ui";
import { usd } from "./components/format";

type Board = { live: boolean; groups: Array<{ collateral: { address: string; symbol: string; isStock: boolean }; best: { borrowApy: number | null; lltv: number; liquidityUsd: number } | null; rows: Array<{ totalSupplyUsd: number }> }> };
type Leader = { totals: { vaults: number; debtUsd: number; collateralUsd: number; repaidFromFeesUsd: number; harvestedUsd: number; refinances: number } };

export default function Landing() {
  const board = useLive<Board>("/api/markets?stocks=1", { live: false, groups: [] });
  const lb = useLive<Leader>("/api/leaderboard", { totals: { vaults: 0, debtUsd: 0, collateralUsd: 0, repaidFromFeesUsd: 0, harvestedUsd: 0, refinances: 0 } }, !!FACTORY);
  const top = board.data?.groups.filter((g) => g.best).slice(0, 6) ?? [];

  return (
    <>
      <Nav />
      <main>
        <section className="hero">
          <div className="wrap">
            <span className="chip"><span className="dot" />{FACTORY ? `live on ${CHAIN_NAME}` : `built for ${CHAIN_NAME}`}</span>
            <h1>Borrow against your stocks.<br />Let the loan pay itself down.</h1>
            <p className="lede">
              Deposit tokenized stocks as collateral on Morpho, borrow USDG, and hand the loan to an agent you scope. It earns Uniswap V3 trading fees, pays them onto your debt, moves the debt when a cheaper market appears, and steps in before liquidation. The vault is yours; the agent's key cannot withdraw.
            </p>
            <div className="row" style={{ marginTop: 28, gap: 12 }}>
              <Link className="btn primary" href="/deploy">Deploy an agent</Link>
              <Link className="btn" href="/rates">See the rates</Link>
              <Link className="btn" href="/docs">How it works</Link>
            </div>
          </div>
        </section>

        <div className="ticker" aria-hidden>
          {(top.length ? top : [null]).map((g, i) => g ? (
            <span key={g.collateral.address}>{g.collateral.symbol} borrow <b>{pct(g.best!.borrowApy)}</b> · LLTV {(g.best!.lltv * 100).toFixed(0)}% · {usd(g.best!.liquidityUsd)} available</span>
          ) : <span key={i}>{board.loading ? "reading Morpho markets…" : "Morpho rates unavailable right now"}</span>)}
        </div>

        {FACTORY && lb.data && (
          <section style={{ padding: "48px 0" }}>
            <div className="wrap stats">
              <div className="stat"><span className="lbl">Vaults</span><span className="big">{lb.data.totals.vaults}</span></div>
              <div className="stat"><span className="lbl">Collateral</span><span className="big">{usd(lb.data.totals.collateralUsd)}</span></div>
              <div className="stat"><span className="lbl">Debt outstanding</span><span className="big">{usd(lb.data.totals.debtUsd)}</span></div>
              <div className="stat"><span className="lbl">Repaid from fees</span><span className="big green">{usd(lb.data.totals.repaidFromFeesUsd, 2)}</span></div>
            </div>
          </section>
        )}

        <section>
          <div className="wrap">
            <span className="eyebrow">How it works</span>
            <h2>Three steps from idle stock tokens to a loan that shrinks on its own.</h2>
            <div className="grid g3" style={{ marginTop: 32 }}>
              <div className="card">
                <span className="lbl">01 · Borrow</span>
                <h3 style={{ marginTop: 8 }}>Collateral in Morpho, debt in USDG</h3>
                <p>Your NVDA, TSLA, SPY or WETH goes into a Morpho Blue market under your own vault contract. You borrow USDG up to a ceiling you set — the market's liquidation threshold is further out.</p>
              </div>
              <div className="card">
                <span className="lbl">02 · Deploy</span>
                <h3 style={{ marginTop: 8 }}>The loan goes to work</h3>
                <p>The agent puts the USDG into the Uniswap V3 pool of the same pair (NVDA/USDG, say) in a range around spot. Stock-token pools on {CHAIN_NAME} turn over millions a day; that volume is fee income.</p>
              </div>
              <div className="card">
                <span className="lbl">03 · Repay</span>
                <h3 style={{ marginTop: 8 }}>Fees pay the debt</h3>
                <p>Every harvest goes straight onto the loan. If another market of the same pair borrows cheaper, the debt moves there in one flash-loan transaction. If LTV crosses your trigger, the agent repays before Morpho can liquidate.</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <span className="eyebrow">Live on Morpho · {CHAIN_NAME}</span>
            <h2>Where the cheapest USDG is today.</h2>
            <p className="lede">One collateral, several markets. Each has its own utilisation and its own rate — the spread between them is what the agent hops.</p>
            <div className="tblwrap" style={{ marginTop: 28 }}>
              <table className="tbl">
                <thead><tr><th>Collateral</th><th className="r">Best borrow APY</th><th className="r">LLTV</th><th className="r">USDG available</th><th className="r">Markets</th></tr></thead>
                <tbody>
                  {top.map((g) => (
                    <tr key={g.collateral.address}>
                      <td><Tok symbol={g.collateral.symbol} /></td>
                      <td className="r green">{pct(g.best!.borrowApy)}</td>
                      <td className="r">{(g.best!.lltv * 100).toFixed(0)}%</td>
                      <td className="r">{usd(g.best!.liquidityUsd)}</td>
                      <td className="r">{g.rows.length}</td>
                    </tr>
                  ))}
                  {top.length === 0 && <tr><td colSpan={5} className="faint">{board.loading ? "Reading markets…" : board.error ?? "No live market data."}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 18 }}><Link className="btn sm" href="/rates">All markets →</Link></div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <span className="eyebrow">Security model</span>
            <h2>Two keys. One can take money out. It is yours.</h2>
            <div className="grid g3" style={{ marginTop: 32 }}>
              <div className="card"><h3>Your vault, your owner key</h3><p>Every position lives in a contract only you own. Withdrawals go to the owner address and nowhere else. Pause, replace the operator, or change the policy any time.</p></div>
              <div className="card"><h3>A scoped operator key</h3><p>The agent's key may borrow within your LTV ceiling, open and close liquidity in the vault's own pair, harvest into the debt, refinance into markets you allow-listed, and repay early. It cannot send tokens anywhere.</p></div>
              <div className="card"><h3>Oracle-policed prices</h3><p>Every swap gets a floor from the Morpho market oracle less your slippage setting, and every mint or burn checks the pool's spot price against the same oracle. A leaked key cannot sandwich the vault through a pool it controls.</p></div>
              <div className="card"><h3>Refinance in one transaction</h3><p>Moving debt uses Morpho's own flash loan: repay the old market, move the collateral, borrow in the new one, repay the flash loan. Either all of it happens or none of it.</p></div>
              <div className="card"><h3>Liquidation protection</h3><p>You set a trigger LTV below the market's threshold and how much to repay when it is hit. The agent closes liquidity first and sells collateral only if it must — atomically, via flash loan.</p></div>
              <div className="card"><h3>Open contracts, open brain</h3><p>The rules the agent follows are one readable file, and the plan it would execute right now is shown on every vault page before it happens. Every action lands on chain with its reason.</p></div>
            </div>
          </div>
        </section>

        <section>
          <div className="wrap">
            <span className="eyebrow">Fees</span>
            <h2>Free to borrow, free to hop. 2.5% of harvested fees, 10% of realized profit.</h2>
            <p className="lede">Deployment, monitoring, refinancing and liquidation protection carry no protocol fee. On managed liquidity the protocol takes 2.5% of the trading fees it harvests and 10% of profit above cost when a position is closed at a gain — never on a loss. Both caps are in the vault's code; the factory owner cannot raise them.</p>
            <div className="row" style={{ marginTop: 28 }}><Link className="btn primary" href="/deploy">Deploy an agent</Link><Link className="btn" href="/docs">Read the docs</Link></div>
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
