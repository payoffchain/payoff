import { ethers, network } from "hardhat";
import { writeFileSync } from "node:fs";

/**
 * Seed a forked Robinhood Chain node with a factory and one working vault, so the web
 * app can be exercised end to end without spending real money.
 *
 *   FORK=1 RPC_URL=<rpc> npx hardhat node --port 8546
 *   npx hardhat run scripts/seed-fork.ts --network localhost
 *
 * Owner = hardhat account #1, operator = account #2. NVDA and USDG are taken from the
 * deepest NVDA/USDG pool by impersonation (fork-only). Writes deployments/fork.json.
 */

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const MORPHO = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
const NFPM = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const UNI_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const POOL = "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3";
const ERC20 = ["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];
const POOL_ABI = ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)", "function tickSpacing() view returns (int24)"];
const MORPHO_ABI = ["function idToMarketParams(bytes32) view returns (address,address,address,address,uint256)"];

async function main() {
  const [deployer, owner, operator, treasury] = await ethers.getSigners();
  // A fresh fork answers calls only for blocks after the fork block; mine one first.
  await network.provider.send("evm_mine", []);
  const snapshot = (await import("../lib/morpho-markets.json")).default as any;
  const idA = snapshot.markets.find((m: any) => m.id.startsWith("0x66306c08")).id;
  const idB = snapshot.markets.find((m: any) => m.id.startsWith("0xbe3a5355")).id;
  const morpho = new ethers.Contract(MORPHO, MORPHO_ABI, deployer);
  const params = async (id: string) => { const p = await morpho.idToMarketParams(id); return { loanToken: p[0], collateralToken: p[1], oracle: p[2], irm: p[3], lltv: p[4] }; };
  const mA = await params(idA);
  const mB = await params(idB);

  await network.provider.send("hardhat_impersonateAccount", [POOL]);
  await network.provider.send("hardhat_setBalance", [POOL, "0x1000000000000000000"]);
  const pool = await ethers.getSigner(POOL);
  await new ethers.Contract(NVDA, ERC20, pool).transfer(owner.address, ethers.parseEther("5"));
  await new ethers.Contract(USDG, ERC20, pool).transfer(owner.address, 500_000_000n);
  await deployer.sendTransaction({ to: operator.address, value: ethers.parseEther("1") });

  const Factory = await ethers.getContractFactory("PayoffVaultFactory", deployer);
  const factory = await Factory.deploy(MORPHO, NFPM, ROUTER, UNI_FACTORY, treasury.address, 250, 1000);
  const rc = await factory.deploymentTransaction()!.wait();
  const factoryAddr = await factory.getAddress();

  const policy = { maxLtvBps: 2000n, triggerLtvBps: 3000n, repayBps: 2500n, maxSlippageBps: 100n };
  const tx = await factory.connect(owner).createVault(operator.address, mA, policy);
  const r = await tx.wait();
  const ev = r!.logs.map((l) => { try { return factory.interface.parseLog(l as any); } catch { return null; } }).find((e) => e?.name === "VaultCreated");
  const vault = await ethers.getContractAt("PayoffVault", ev!.args.vault);
  const vaultAddr = await vault.getAddress();
  await vault.connect(owner).setMarketAllowed(mB, true);

  await new ethers.Contract(NVDA, ERC20, owner).approve(vaultAddr, ethers.MaxUint256);
  await vault.connect(owner).depositCollateral(ethers.parseEther("2"));
  await vault.connect(operator).borrow(60_000_000n);

  const p = new ethers.Contract(POOL, POOL_ABI, deployer);
  const [, tick] = await p.slot0();
  const spacing = Number(await p.tickSpacing());
  const width = Math.round(Math.log(1.05) / Math.log(1.0001));
  const tickLower = Math.floor((Number(tick) - width) / spacing) * spacing;
  const tickUpper = Math.ceil((Number(tick) + width) / spacing) * spacing;
  const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 600;
  await vault.connect(operator).openLp({ fee: 500, tickLower, tickUpper, loanAmount: 40_000_000n, swapAmount: 20_000_000n, swapMinOut: 0n, amount0Min: 0n, amount1Min: 0n, deadline });

  const out = { chainId: 4663, fork: true, factory: factoryAddr, factoryBlock: rc!.blockNumber, vault: vaultAddr, owner: owner.address, operator: operator.address, operatorKey: "hardhat account #2", markets: { A: idA, B: idB } };
  writeFileSync("deployments/fork.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`\n.env for the site:\nRPC_URL=http://127.0.0.1:8546\nPAYOFF_FACTORY_ADDRESS=${factoryAddr}\nNEXT_PUBLIC_PAYOFF_FACTORY_ADDRESS=${factoryAddr}\nPAYOFF_FACTORY_START_BLOCK=${rc!.blockNumber}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
