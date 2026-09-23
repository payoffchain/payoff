# PAYOFF

Self-repaying loans on **Robinhood Chain**. Borrow USDG against tokenized stocks (or WETH, USDe…) on **Morpho Blue**; an agent you scope puts the loan to work in the pair's **Uniswap V3** pool, pays the trading fees onto the debt, moves the debt to a cheaper Morpho market when one appears, and repays early before Morpho can liquidate. Non-custodial: the vault is yours, the operator key cannot withdraw.

The product shape follows [Ratehopper](https://ratehopper.ai) (Base); the mechanics are rebuilt for what is actually live on Robinhood Chain: one Morpho Blue deployment with ~200 markets (mostly `<stock>/USDG` at LLTV 39 / 63 / 77 / 86 %), Uniswap V3 pools for the same pairs, Chainlink-backed Morpho oracles.

## What is in the repo

| Part | Where | Deployed to |
|---|---|---|
| Smart contracts (`PayoffVaultFactory`, `PayoffVault`) | `contracts/` | Robinhood Chain, from your machine with Hardhat |
| Web app + API (Next.js) | `app/`, `lib/` | Vercel (or any Node host) |
| Agent runner | `agent/` | Railway or any always-on box |

### The vault

One `PayoffVault` per (owner, pair), cloned by the factory. Collateral sits in a Morpho market under the vault's name; borrowed USDG stays in the vault until it is deployed into the pair's Uniswap V3 pool as an NFT position the vault owns.

* **Owner** (your wallet): deposit, withdraw (always to the owner), set policy, set operator, allow-list markets, pause, propose a new owner (two-step).
* **Operator** (the agent key): borrow within the policy ceiling, open/close liquidity in the vault's own pair, harvest fees into the debt, refinance into allow-listed markets of the same pair, run liquidation protection.
* **Nobody** can send a token to any address other than Morpho, the position manager, the swap router, or the treasury's capped fee.

Prices are policed by the market oracle: every swap gets a floor of oracle less `maxSlippageBps`, and every mint/burn first checks the pool's spot price against the oracle. Refinancing and collateral sales in `protect()` use Morpho's own flash loan, so they are atomic.

Fees: 2.5 % of harvested trading fees and 10 % of realized profit above cost when a position is closed at a gain (never on a loss). Hard caps of 5 % / 20 % live in the vault code; the factory owner cannot raise them. Borrowing, refinancing and protection are free.

### The brain

`lib/services/plan.ts` is the whole decision procedure: **protect → refinance → close (loss limit / out of range) → harvest → deploy idle USDG**. The site evaluates it for any vault at `GET /api/vaults/<vault>/plan` with calldata for each action; the vault page shows it under "What the agent would do"; the runner signs it. With `ANTHROPIC_API_KEY`, Claude may veto an action with a reason — it can never add one.

## 1. Contracts

```bash
npm install
cp .env.example .env      # DEPLOYER_PRIVATE_KEY, TREASURY_ADDRESS
npm run compile
npm test                  # 25 Hardhat tests against Morpho / Uniswap mocks
npm run deploy:contracts  # PayoffVaultFactory (+ vault implementation) -> deployments/4663.json
npm run verify -- <factory> <constructor args printed by the deploy>
```

Against the real protocols on a fork of Robinhood Chain (borrows NVDA by impersonation, creates a vault, borrows from one Morpho market, opens a ±5 % position in the 0.05 % NVDA/USDG pool, refinances into a second market through Morpho's flash loan, closes and repays):

```bash
FORK=1 RPC_URL=<rpc> npm run test:fork
```

### Try it on a fork (no real money)

```bash
FORK=1 RPC_URL=<rpc> npx hardhat node --port 8546      # a local copy of Robinhood Chain
npx hardhat run scripts/seed-fork.ts --network localhost # factory + one funded NVDA/USDG vault
# then in .env: RPC_URL=http://127.0.0.1:8546 and the PAYOFF_FACTORY_* lines the script prints
npm run dev
```

The seeded vault (owner = hardhat account #1, operator = account #2) shows up on /leaderboard and /vault/<address>; the runner can be pointed at it with account #2's key and `AGENT_DRY_RUN=false` to watch it deploy the idle USDG.

## 2. Web app

```bash
npm run dev
```

Env (see `.env.example`): `RPC_URL`, `CHAIN_ID=4663`, `PAYOFF_FACTORY_ADDRESS`, `NEXT_PUBLIC_PAYOFF_FACTORY_ADDRESS`, `PAYOFF_FACTORY_START_BLOCK`. The Morpho / Uniswap / USDG addresses default to the canonical Robinhood Chain deployments. `/api/health` names anything missing.

The market list (`lib/morpho-markets.json`) is a snapshot from the Morpho API; refresh it with `npm run sync-markets`. Rates, totals and oracle prices are read on chain every time.

Pages: `/` landing · `/rates` every USDG market by collateral · `/app` your vaults · `/deploy` five-step wizard (owner wallet → market → policy → operator key made in the browser → create) · `/vault/<address>` position, agent plan, activity log, settings · `/leaderboard` · `/docs`.

API: `GET /api/markets`, `GET /api/markets/opportunities`, `GET /api/pools?collateral=`, `GET /api/vaults[?owner=]`, `GET /api/vaults/<v>`, `/plan`, `/activity`, `/targets`, `POST /api/vaults/<v>/tx {action…}` (unsigned calldata), `POST /api/tx/create`, `GET /api/leaderboard`, `GET /api/health`. The server holds no key: every write route returns calldata the owner's wallet signs.

## 3. Agent runner

```bash
PAYOFF_API_URL=https://<site> AGENT_PRIVATE_KEY=<operator key> AGENT_DRY_RUN=false npm run agent
```

Dry-run by default (`AGENT_DRY_RUN=true`): every decision is made and logged on `GET :3001/decisions`, nothing is signed. It operates every vault whose operator is its key (or `AGENT_VAULTS`), simulates each transaction before sending, and refuses to sign below `AGENT_MIN_ETH`.

## Local RPC note

Some ISP resolvers hijack `rpc.mainnet.chain.robinhood.com` and serve an expired certificate. `node scripts/rpc-proxy.mjs` resolves the host over DNS-over-HTTPS and forwards with the right TLS servername; then use `RPC_URL=http://127.0.0.1:8545`. Vercel does not need it. The public RPC is not an archive node, so pool fee yield is estimated from recent Swap events, not from historic fee growth.

## Tests

* `npm test` — Hardhat: factory, policy, borrow/repay, LP open/harvest/close, refinance (flash loan), protection, permissions.
* `npm run test:ts` — vitest: tick maths, Morpho id/rate/share maths, token metadata.
* `npm run test:fork` — the real thing on a fork.
* `npm run typecheck`, `npm run build`.

## Renaming

`NEXT_PUBLIC_APP_NAME` changes the wordmark; contract names are `Payoff*`. Everything else is chain constants.

<p align="center"><img src=".github/assets/demo.gif" alt="The product tour: pick a stock, open the loan, fees pay it down" width="760"></p>

