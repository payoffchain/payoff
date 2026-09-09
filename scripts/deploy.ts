import { ethers, network } from "hardhat";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";

/**
 * Deploy PayoffVaultFactory (which deploys the vault implementation) to Robinhood Chain.
 *
 *   npm run deploy:contracts
 *
 * Env: DEPLOYER_PRIVATE_KEY, TREASURY_ADDRESS (defaults to the deployer, loudly),
 * HARVEST_FEE_BPS (250), PERFORMANCE_FEE_BPS (1000), and the third-party addresses
 * (defaults are the canonical Robinhood Chain deployments). Writes deployments/<chainId>.json.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const env = (k: string, d: string) => process.env[k] || d;
  const cfg = {
    morpho: env("MORPHO_ADDRESS", "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010"),
    positionManager: env("UNISWAP_V3_POSITION_MANAGER", "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3"),
    swapRouter: env("UNISWAP_V3_SWAP_ROUTER", "0xcaf681a66d020601342297493863e78c959e5cb2"),
    uniswapFactory: env("UNISWAP_V3_FACTORY", "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"),
    treasury: env("TREASURY_ADDRESS", deployer.address),
    harvestFeeBps: Number(env("HARVEST_FEE_BPS", "250")),
    performanceFeeBps: Number(env("PERFORMANCE_FEE_BPS", "1000")),
  };
  if (!process.env.TREASURY_ADDRESS) console.warn("TREASURY_ADDRESS not set: the deployer receives protocol fees. Change it with factory.setTreasury().");
  console.log(`network ${network.name} chainId ${chainId} deployer ${deployer.address} balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Every third-party address must have code: a typo here deploys a factory that can never work.
  for (const [k, a] of Object.entries({ morpho: cfg.morpho, positionManager: cfg.positionManager, swapRouter: cfg.swapRouter, uniswapFactory: cfg.uniswapFactory })) {
    const code = await ethers.provider.getCode(a);
    if (!code || code === "0x") throw new Error(`${k} ${a} has no code on chain ${chainId}`);
  }

  const Factory = await ethers.getContractFactory("PayoffVaultFactory");
  const factory = await Factory.deploy(cfg.morpho, cfg.positionManager, cfg.swapRouter, cfg.uniswapFactory, cfg.treasury, cfg.harvestFeeBps, cfg.performanceFeeBps);
  const rc = await factory.deploymentTransaction()!.wait();
  const address = await factory.getAddress();
  const implementation = await factory.implementation();
  console.log(`PayoffVaultFactory ${address} (implementation ${implementation}) at block ${rc!.blockNumber}`);

  mkdirSync("deployments", { recursive: true });
  const file = `deployments/${chainId}.json`;
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const out = { ...prev, chainId, network: network.name, deployedAt: new Date().toISOString(), deployer: deployer.address, block: rc!.blockNumber, addresses: { PAYOFF_FACTORY_ADDRESS: address, PAYOFF_VAULT_IMPLEMENTATION: implementation, ...cfg } };
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${file}\n\nPut these in .env / Vercel:\nPAYOFF_FACTORY_ADDRESS=${address}\nNEXT_PUBLIC_PAYOFF_FACTORY_ADDRESS=${address}\nPAYOFF_FACTORY_START_BLOCK=${rc!.blockNumber}\n\nVerify:\nnpm run verify -- ${address} ${cfg.morpho} ${cfg.positionManager} ${cfg.swapRouter} ${cfg.uniswapFactory} ${cfg.treasury} ${cfg.harvestFeeBps} ${cfg.performanceFeeBps}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
