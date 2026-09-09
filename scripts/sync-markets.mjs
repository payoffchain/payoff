// Snapshot every Morpho Blue market on Robinhood Chain from the Morpho API into
// lib/morpho-markets.json. The site reads live from the API when it can and falls back
// to this file (with its age shown) when it cannot; the on-chain reads (rates, positions)
// only need the market params, which never change once a market exists.
import { writeFileSync } from "node:fs";

const API = process.env.MORPHO_API ?? "https://blue-api.morpho.org/graphql";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 4663);

const QUERY = `query($skip: Int!) {
  markets(first: 100, skip: $skip, where: { chainId_in: [${CHAIN_ID}] }) {
    pageInfo { countTotal count skip limit }
    items {
      marketId lltv listed irmAddress creationTimestamp
      oracle { address }
      loanAsset { address symbol decimals name priceUsd }
      collateralAsset { address symbol decimals name priceUsd }
      morphoBlue { address }
      state { borrowApy supplyApy netBorrowApy netSupplyApy utilization supplyAssetsUsd borrowAssetsUsd liquidityAssetsUsd collateralAssetsUsd }
    }
  }
}`;

async function page(skip) {
  const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: QUERY, variables: { skip } }) });
  if (!res.ok) throw new Error(`morpho api ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.markets;
}

const items = [];
let skip = 0;
let total = Infinity;
while (skip < total) {
  const p = await page(skip);
  total = p.pageInfo.countTotal;
  items.push(...p.items);
  skip += p.items.length;
  if (p.items.length === 0) break;
}

const markets = items
  .filter((m) => m.collateralAsset && m.loanAsset && m.loanAsset.address !== "0x0000000000000000000000000000000000000000")
  .map((m) => ({
    id: m.marketId,
    loanToken: m.loanAsset.address,
    collateralToken: m.collateralAsset.address,
    oracle: m.oracle?.address ?? null,
    irm: m.irmAddress,
    lltv: String(m.lltv),
    listed: m.listed,
    createdAt: Number(m.creationTimestamp) || null,
    loan: { symbol: m.loanAsset.symbol, decimals: m.loanAsset.decimals, name: m.loanAsset.name ?? null },
    collateral: { symbol: m.collateralAsset.symbol, decimals: m.collateralAsset.decimals, name: m.collateralAsset.name ?? null },
    state: m.state ? {
      borrowApy: m.state.borrowApy, supplyApy: m.state.supplyApy, utilization: m.state.utilization,
      supplyUsd: m.state.supplyAssetsUsd, borrowUsd: m.state.borrowAssetsUsd, liquidityUsd: m.state.liquidityAssetsUsd, collateralUsd: m.state.collateralAssetsUsd,
    } : null,
  }));

const morpho = items.find((m) => m.morphoBlue?.address)?.morphoBlue.address ?? null;
const out = { chainId: CHAIN_ID, source: API, fetchedAt: new Date().toISOString(), morpho, count: markets.length, markets };
writeFileSync("lib/morpho-markets.json", JSON.stringify(out, null, 2) + "\n");
console.log(`wrote lib/morpho-markets.json: ${markets.length} markets, morpho=${morpho}`);
