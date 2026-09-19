// Roll new Morpho markets onto the site one at a time.
//
//   node scripts/add-market.mjs            list what is waiting (new markets with liquidity)
//   node scripts/add-market.mjs NVDA       add every waiting market of that collateral
//   node scripts/add-market.mjs 0xabc…     add one market by id
//
// scripts/markets-full.json is the complete snapshot from `npm run sync-markets`;
// lib/morpho-markets.json is what the site shows. This script moves entries across.
import { readFileSync, writeFileSync } from "node:fs";

const FULL = new URL("./markets-full.json", import.meta.url);
const LIVE = new URL("../lib/morpho-markets.json", import.meta.url);
const MIN_LIQ = Number(process.env.MIN_LIQUIDITY_USD ?? 100);

const full = JSON.parse(readFileSync(FULL, "utf8"));
const live = JSON.parse(readFileSync(LIVE, "utf8"));
const have = new Set(live.markets.map((m) => m.id));
const waiting = full.markets
  .filter((m) => !have.has(m.id) && (m.state?.liquidityUsd ?? 0) >= MIN_LIQ)
  .sort((a, b) => (b.state?.liquidityUsd ?? 0) - (a.state?.liquidityUsd ?? 0));

const arg = process.argv[2];
if (!arg) {
  console.log(`live: ${live.markets.length} markets · waiting with at least $${MIN_LIQ} to borrow: ${waiting.length}\n`);
  for (const m of waiting) console.log(`${m.collateral.symbol.padEnd(22)} LLTV ${(Number(m.lltv) / 1e16).toFixed(1).padStart(5)}%  available $${Math.round(m.state.liquidityUsd).toLocaleString("en-US").padStart(9)}  borrow ${(m.state.borrowApy * 100).toFixed(2)}%  ${m.id.slice(0, 12)}…`);
  process.exit(0);
}
const pick = waiting.filter((m) => m.id.toLowerCase() === arg.toLowerCase() || m.collateral.symbol.toLowerCase() === arg.toLowerCase());
if (pick.length === 0) { console.error(`nothing waiting matches "${arg}"`); process.exit(1); }
live.markets.push(...pick);
live.count = live.markets.length;
live.fetchedAt = full.fetchedAt;
writeFileSync(LIVE, JSON.stringify(live, null, 2) + "\n");
for (const m of pick) console.log(`added ${m.collateral.symbol}/${m.loan.symbol} LLTV ${(Number(m.lltv) / 1e16).toFixed(1)}% · $${Math.round(m.state.liquidityUsd).toLocaleString("en-US")} available · ${m.id}`);
console.log(`live: ${live.markets.length} markets`);
