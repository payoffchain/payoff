// Point the Factory's treasury (where protocol fees land) at a new address.
//   DEPLOYER_PRIVATE_KEY=... node scripts/set-treasury.mjs 0xNewTreasury
// Only the factory owner can call setTreasury; the script refuses any other key.
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const deployments = JSON.parse(readFileSync(new URL("../deployments/4663.json", import.meta.url), "utf8"));
const FACTORY = deployments.addresses?.PAYOFF_FACTORY_ADDRESS ?? deployments.factory;
const next = process.argv[2];
const key = process.env.DEPLOYER_PRIVATE_KEY; // the factory OWNER key (PAYOFF_OWNER_PRIVATE_KEY since 12 Sep 2026)
if (!ethers.isAddress(next ?? "")) { console.error("usage: node scripts/set-treasury.mjs 0xNewTreasury"); process.exit(1); }
if (!key) { console.error("DEPLOYER_PRIVATE_KEY is not set"); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true });
const wallet = new ethers.Wallet(key, provider);
const factory = new ethers.Contract(FACTORY, [
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function setTreasury(address)",
], wallet);

const owner = await factory.owner();
if (owner.toLowerCase() !== wallet.address.toLowerCase()) { console.error(`this key (${wallet.address}) is not the factory owner (${owner})`); process.exit(1); }
console.log("factory", FACTORY);
console.log("treasury before", await factory.treasury());
const tx = await factory.setTreasury(next);
console.log("sent", tx.hash);
const rc = await tx.wait(1);
console.log("mined in block", rc.blockNumber, rc.status === 1 ? "ok" : "REVERTED");
console.log("treasury after ", await factory.treasury());
console.log("deployer ETH left", ethers.formatEther(await provider.getBalance(wallet.address)));
