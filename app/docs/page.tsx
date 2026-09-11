import Link from "next/link";
import Nav from "../components/Nav";
import { APP, CHAIN_NAME } from "../components/brand";

export const metadata = { title: "Docs" };

export default function Docs() {
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 80px", maxWidth: 820 }}>
        <span className="eyebrow">Docs</span>
        <h2>How {APP} works.</h2>
        <p className="lede">{APP} is a non-custodial agent protocol for self-repaying loans on {CHAIN_NAME}. You borrow USDG against tokenized stocks (or WETH, USDe…) on Morpho Blue; an agent you scope earns Uniswap V3 trading fees with the loan and pays them onto the debt.</p>

        <h3 style={{ marginTop: 40 }}>The vault</h3>
        <p className="mute">Every position lives in its own <code className="inline">PayoffVault</code>, a small contract the factory clones for you. It holds one pair — collateral token and loan token — for its whole life. The collateral sits in a Morpho market under the vault's name; borrowed USDG stays in the vault until it is deployed into the pair's Uniswap V3 pool as an NFT position the vault owns.</p>
        <div className="card soft" style={{ marginTop: 14 }}>
          <div className="kv"><span>Owner (you)</span><b>deposit · withdraw to owner · set policy · set operator · allow-list markets · pause · propose new owner</b></div>
          <div className="kv"><span>Operator (the agent key)</span><b>borrow within the ceiling · open/close liquidity in the pair · harvest into debt · refinance into allowed markets · protect</b></div>
          <div className="kv"><span>Neither</span><b>send a token to any address but Morpho, the position manager, the swap router, or the treasury's capped fee</b></div>
        </div>

        <h3 style={{ marginTop: 40 }}>The policy</h3>
        <div className="steps" style={{ marginTop: 10 }}>
          <div className="step"><div><h3>Borrow ceiling (max LTV)</h3><p>No borrow or refinance may leave loan-to-value above this. Set it well under the market's LLTV so a price move does not become a liquidation.</p></div></div>
          <div className="step"><div><h3>Protection trigger and repay share</h3><p>Once LTV reaches the trigger, <code className="inline">protect()</code> repays the given share of the debt: first with idle USDG, then by closing positions into USDG, then by selling collateral. That last step borrows the repayment from Morpho's flash loan, frees the collateral, sells it, and pays the loan back inside one transaction.</p></div></div>
          <div className="step"><div><h3>Max slippage</h3><p>Every swap the vault makes gets a floor of the Morpho oracle price less this. Every mint and burn first checks that the pool's spot price is within this of the oracle. An operator can pass a floor of zero; the vault tightens it.</p></div></div>
        </div>

        <h3 style={{ marginTop: 40 }}>Refinancing</h3>
        <p className="mute">On {CHAIN_NAME} one collateral usually has several Morpho markets against USDG, at different LLTVs and with different curators. Each has its own utilisation and so its own borrow rate. You allow-list the markets you trust; when one is cheaper by at least the savings threshold, has the liquidity, and keeps LTV inside the ceiling, the agent moves the whole position there: flash-borrow the debt, repay the old market, withdraw the collateral, supply it to the new market, borrow there, repay the flash loan. All or nothing.</p>

        <h3 style={{ marginTop: 40 }}>The agent</h3>
        <p className="mute">The brain is one file, <code className="inline">lib/services/plan.ts</code>, evaluated by the site for any vault at <code className="inline">/api/vaults/&lt;vault&gt;/plan</code>. In priority order: protect, refinance, close (loss limit or out of range), harvest (above the fee floor), deploy idle USDG into the pool with the best recent fee yield. The runner (<code className="inline">agent/index.mjs</code>) fetches the plan every tick, simulates each transaction, and signs with the operator key. It starts in dry-run. With an Anthropic key, Claude may veto an action with a reason — it can never add one.</p>

        <h3 style={{ marginTop: 40 }}>Fees</h3>
        <div className="card soft" style={{ marginTop: 10 }}>
          <div className="kv"><span>Deploying, monitoring, refinancing, protection</span><b>free</b></div>
          <div className="kv"><span>Harvested trading fees</span><b>2.5% to the protocol (vault cap: 5%)</b></div>
          <div className="kv"><span>Closing a position at a profit</span><b>10% of profit above cost basis (cap: 20%); nothing on a loss</b></div>
          <div className="kv"><span>Gas and Morpho / Uniswap fees</span><b>standard, paid by the vault or the operator</b></div>
        </div>

        <h3 style={{ marginTop: 40 }}>Risks, plainly</h3>
        <ul className="mute" style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>A concentrated position carries impermanent loss; if the stock moves out of the range it stops earning and the agent closes it into USDG, realising the move.</li>
          <li>Debt accrues interest whether or not the position earns. Fee income is variable; a quiet week can be a losing week.</li>
          <li>Liquidation protection needs the agent to be running and funded with gas. A vault with the agent turned off does not protect itself.</li>
          <li>Equity oracles pause outside market hours; the vault refuses to mint or burn while the pool price drifts from the oracle beyond your slippage.</li>
          <li>Thin markets show any rate. A "best" rate with no liquidity cannot be borrowed.</li>
        </ul>

        <h3 style={{ marginTop: 40 }}>API</h3>
        <pre className="code">{`GET  /api/health
GET  /api/markets[?stocks=1]                 Morpho USDG markets by collateral, live rates
GET  /api/markets/opportunities?from=&debt=&collateral=
GET  /api/pools?collateral=0x..              Uniswap V3 pools for the pair, fee yield from recent swaps
GET  /api/vaults[?owner=0x..]
GET  /api/vaults/<vault>                     full state
GET  /api/vaults/<vault>/plan                what the agent would do now (with calldata)
GET  /api/vaults/<vault>/activity            event log
GET  /api/vaults/<vault>/targets             markets of the pair, for the allow-list
POST /api/vaults/<vault>/tx  {action, ...}   unsigned calldata for any vault action
POST /api/tx/create {marketId, operator, policy}
GET  /api/leaderboard`}</pre>
        <p className="row" style={{ marginTop: 28 }}><Link className="btn primary" href="/deploy">Deploy an agent</Link><Link className="btn" href="/rates">Rates</Link></p>
      </main>
    </>
  );
}
