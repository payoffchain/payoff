import Link from "next/link";
import Nav from "../components/Nav";
import { APP, CHAIN_NAME, HOSTED_OPERATOR, HOSTED_STATUS_URL } from "../components/brand";

export const metadata = { title: "Docs" };

export default function Docs() {
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 80px", maxWidth: 820 }}>
        <span className="eyebrow">Docs</span>
        <h2>How {APP} works.</h2>
        <p className="lede">{APP} is a non-custodial protocol for self-repaying loans on {CHAIN_NAME}. You borrow USDG against tokenized stocks (or WETH, USDe…) on Morpho Blue; the borrowed USDG earns Uniswap V3 trading fees and every fee is paid onto the debt. The part that does the work is a small program we call the agent; this page explains it in full.</p>

        <h3 style={{ marginTop: 40 }}>The vault</h3>
        <p className="mute">Every position lives in its own <code className="inline">PayoffVault</code>, a small contract the factory clones for you. It holds one pair — collateral token and loan token — for its whole life. The collateral sits in a Morpho market under the vault's name; borrowed USDG stays in the vault until it is deployed into the pair's Uniswap V3 pool as an NFT position the vault owns.</p>
        <div className="card soft" style={{ marginTop: 14 }}>
          <div className="kv"><span>Owner (you)</span><b>deposit · withdraw to owner · set policy · set operator · allow-list markets · pause · propose new owner</b></div>
          <div className="kv"><span>Operator (the agent key)</span><b>borrow within the ceiling · open/close liquidity in the pair · harvest into debt · refinance into allowed markets · protect</b></div>
          <div className="kv"><span>Neither</span><b>send a token to any address but Morpho, the position manager, the swap router, or the treasury's capped fee</b></div>
        </div>

        <h3 id="your-money" style={{ marginTop: 40 }}>Your money in the vault</h3>
        <p className="mute">Short version: everything in the vault is yours, only you can take it out, and you can take it out at any time. Here is where each thing sits and how it comes back.</p>
        <div className="card soft" style={{ marginTop: 14 }}>
          <div className="kv"><span>Your collateral (the stock)</span><b>Held by Morpho under your vault's name. Comes back with <em>Withdraw collateral</em> on the vault page, straight to your wallet.</b></div>
          <div className="kv"><span>The USDG you borrowed</span><b>Sits in the vault until it is put into the Uniswap pool. Idle USDG comes back with <em>Withdraw token</em>; USDG in a pool comes back when the position is closed.</b></div>
          <div className="kv"><span>Fees the pool earned</span><b>Collected by <em>Harvest</em> and used to repay your debt. Nothing is kept aside; the protocol's 2.5% is taken from the fee at that moment.</b></div>
        </div>
        <div className="steps" style={{ marginTop: 14 }}>
          <div className="step"><div><h3>Who can move it</h3><p>The vault contract only ever sends tokens to four places: Morpho, the Uniswap position manager, the Uniswap router, and your own wallet. Your wallet is the only destination for a withdrawal. The agent's key cannot change that, and neither can {APP}. This is in the code, not in a promise.</p></div></div>
          <div className="step"><div><h3>How to get everything out</h3><p>Two or three clicks on the vault page, in this order: <em>Close</em> any open position into USDG (the agent may have done this already), <em>Repay</em> the debt, then <em>Withdraw collateral</em>. If USDG is left over after repaying, <em>Withdraw token</em> sends it to you. Morpho will not let collateral leave while it still backs debt, which is why repay comes before withdraw.</p></div></div>
          <div className="step"><div><h3>What can make it smaller</h3><p>Three things, all visible on the vault page: interest on the USDG you borrowed (the rate shown on the market), the market moving against a liquidity position (a position that holds more of the stock after the price fell is worth less in USDG), and, if the price falls far enough with nobody repaying, liquidation by Morpho. The policy's protection trigger exists to repay before that last one happens; it only works while an agent is running.</p></div></div>
          <div className="step"><div><h3>What cannot happen</h3><p>Your collateral cannot be sent to someone else. The agent cannot borrow past the ceiling you set. No swap can fill below the oracle price less your slippage setting. If the price oracle stops answering, the vault refuses to trade at all rather than trade blind. Turning the agent off stops every automatic action immediately; your own buttons keep working.</p></div></div>
          <div className="step"><div><h3>If {APP} disappears</h3><p>The vault is a contract on {CHAIN_NAME}; it does not need this website. You can call <code className="inline">repay</code>, <code className="inline">withdrawCollateral</code> and <code className="inline">withdrawToken</code> from the block explorer with your owner wallet, and the collateral comes back the same way.</p></div></div>
        </div>

        <h3 style={{ marginTop: 40 }}>The policy</h3>
        <div className="steps" style={{ marginTop: 10 }}>
          <div className="step"><div><h3>Borrow ceiling (max LTV)</h3><p>No borrow or refinance may leave loan-to-value above this. Set it well under the market's LLTV so a price move does not become a liquidation.</p></div></div>
          <div className="step"><div><h3>Protection trigger and repay share</h3><p>Once LTV reaches the trigger, <code className="inline">protect()</code> repays the given share of the debt: first with idle USDG, then by closing positions into USDG, then by selling collateral. That last step borrows the repayment from Morpho's flash loan, frees the collateral, sells it, and pays the loan back inside one transaction.</p></div></div>
          <div className="step"><div><h3>Max slippage</h3><p>Every swap the vault makes gets a floor of the Morpho oracle price less this. Every mint and burn first checks that the pool's spot price is within this of the oracle. An operator can pass a floor of zero; the vault tightens it.</p></div></div>
        </div>

        <h3 style={{ marginTop: 40 }}>Refinancing</h3>
        <p className="mute">On {CHAIN_NAME} one collateral usually has several Morpho markets against USDG, at different LLTVs and with different curators. Each has its own utilization and so its own borrow rate. You allow-list the markets you trust; when one is cheaper by at least the savings threshold, has the liquidity, and keeps LTV inside the ceiling, the agent moves the whole position there: flash-borrow the debt, repay the old market, withdraw the collateral, supply it to the new market, borrow there, repay the flash loan. All or nothing.</p>

        <h3 id="runner" style={{ marginTop: 40 }}>Who runs auto-repay</h3>
        <p className="mute">By default, {APP} does. A program we host checks every vault whose operator is our key{HOSTED_OPERATOR ? <> (<code className="inline">{HOSTED_OPERATOR}</code>)</> : null} once a minute and signs the steps the plan below calls for. The key is an <em>operator</em>: the contract lets it borrow within your ceiling, place and collect liquidity, repay, refinance between markets you allowed, and run protection. It cannot withdraw anything; every withdraw path pays the owner and nobody else. What a stolen or faulty operator key could still do is trade badly, and the contract bounds that: every swap is held to your slippage band around the oracle price, the key may only use the pools you allowed, and it has to wait (six hours unless you change it) between two new positions, so a loss could only build slowly and in plain sight. You can turn it off on the vault page, or replace it with your own key at any time.{HOSTED_STATUS_URL ? <> Its live status is public at <a href={`${HOSTED_STATUS_URL}/health`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>{HOSTED_STATUS_URL.replace(/^https?:\/\//, "")}/health ↗</a>.</> : null}</p>
        <p className="mute">Prefer to run it yourself? Choose "I'd rather run it myself" in the borrow wizard, save the key it makes, and start <code className="inline">npm run agent</code> on any machine that stays on, with <code className="inline">PAYOFF_API_URL</code>, <code className="inline">PAYOFF_FACTORY_ADDRESS</code>, <code className="inline">AGENT_VAULTS</code> and <code className="inline">AGENT_PRIVATE_KEY</code> set. It starts in dry-run: watch <code className="inline">/decisions</code> first, then set <code className="inline">AGENT_DRY_RUN=false</code>.</p>

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
          <li>A concentrated position carries impermanent loss; if the stock moves out of the range it stops earning and the agent closes it into USDG, realizing the move.</li>
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
        <p className="row" style={{ marginTop: 28 }}><Link className="btn green" href="/borrow">Open a loan</Link><Link className="btn" href="/rates">Rates</Link></p>
      </main>
    </>
  );
}
