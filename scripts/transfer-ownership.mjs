// Hand the Factory to the fresh PAYOFF owner wallet (Ownable2Step: propose from the
// current owner, then accept from the new one). The new owner gets a sliver of gas
// from the operator wallet first so it can accept.
//   DEPLOYER_PRIVATE_KEY=... NEW_OWNER_PRIVATE_KEY=... GAS_PRIVATE_KEY=... node scripts/transfer-ownership.mjs
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const deployments = JSON.parse(readFileSync(new URL("../deployments/4663.json", import.meta.url), "utf8"));
const FACTORY = deployments.addresses.PAYOFF_FACTORY_ADDRESS;
const ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function transferOwnership(address)",
  "function acceptOwnership()",
];
for (const k of ["DEPLOYER_PRIVATE_KEY", "NEW_OWNER_PRIVATE_KEY", "GAS_PRIVATE_KEY"]) if (!process.env[k]) { console.error(`${k} is required`); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC, 4663, { staticNetwork: true });
const current = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const next = new ethers.Wallet(process.env.NEW_OWNER_PRIVATE_KEY, provider);
const gas = new ethers.Wallet(process.env.GAS_PRIVATE_KEY, provider);
const factory = new ethers.Contract(FACTORY, ABI, current);

const owner = await factory.owner();
if (owner.toLowerCase() !== current.address.toLowerCase()) { console.error(`${current.address} is not the owner (${owner})`); process.exit(1); }
console.log("factory", FACTORY, "owner", owner, "->", next.address);

// gas for the accept call: Robinhood Chain fees are tiny, 0.0005 ETH covers many calls
const GAS_GIFT = ethers.parseEther("0.0005");
if ((await provider.getBalance(next.address)) < GAS_GIFT) {
  const g = await gas.sendTransaction({ to: next.address, value: GAS_GIFT });
  console.log("gas from", gas.address, g.hash); await g.wait(1);
}
const t = await factory.transferOwnership(next.address);
console.log("proposed", t.hash); await t.wait(1);
console.log("pending owner", await factory.pendingOwner());
const a = await factory.connect(next).acceptOwnership();
console.log("accepted", a.hash); await a.wait(1);
console.log("owner now", await factory.owner());
console.log("new owner ETH", ethers.formatEther(await provider.getBalance(next.address)), "operator ETH", ethers.formatEther(await provider.getBalance(gas.address)));
