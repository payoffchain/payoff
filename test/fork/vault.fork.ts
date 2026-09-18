import { expect } from "chai";
import { ethers, network } from "hardhat";

/**
 * The vault against the REAL Morpho Blue and Uniswap V3 on a fork of Robinhood Chain.
 *
 *   FORK=1 RPC_URL=<robinhood rpc> npm run test:fork
 *
 * NVDA is borrowed from the deepest NVDA/USDG pool by impersonation (a fork-only trick),
 * a vault is created, funded and used end to end: borrow from one Morpho market, open a
 * concentrated position in the 0.05% pool, refinance the debt into another market with
 * Morpho's flash loan, close the position into USDG, repay. Skipped without FORK=1.
 */

const FORK = !!process.env.FORK;
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const MORPHO = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
const NFPM = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const UNI_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const NVDA_POOL_005 = "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3"; // deepest NVDA/USDG pool: the NVDA source
// NVDA/USDG Morpho markets with USDG to lend at the time of writing
const MARKET_A = "0x66306c08"; // lltv 62.5%, ~$13k available
const MARKET_B = "0xbe3a5355"; // lltv 38.5%, ~$100 available

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)"];
const MORPHO_ABI = ["function idToMarketParams(bytes32) view returns (address loanToken,address collateralToken,address oracle,address irm,uint256 lltv)", "function position(bytes32,address) view returns (uint256 supplyShares,uint128 borrowShares,uint128 collateral)", "function market(bytes32) view returns (uint128,uint128,uint128,uint128,uint128,uint128)"];
const POOL_ABI = ["function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)", "function tickSpacing() view returns (int24)"];

(FORK ? describe : describe.skip)("PayoffVault on a Robinhood Chain fork", function () {
  this.timeout(600_000);

  it("borrows, deploys liquidity, refinances, closes and repays against the real protocols", async () => {
    const [deployer, user, operator, treasury] = await ethers.getSigners();
    const nvda = new ethers.Contract(NVDA, ERC20, user);
    const usdg = new ethers.Contract(USDG, ERC20, user);
    const morpho = new ethers.Contract(MORPHO, MORPHO_ABI, user);

    // 1. get NVDA: impersonate the deepest pool and move 2 NVDA out of it
    await network.provider.send("hardhat_impersonateAccount", [NVDA_POOL_005]);
    await network.provider.send("hardhat_setBalance", [NVDA_POOL_005, "0x1000000000000000000"]);
    const poolSigner = await ethers.getSigner(NVDA_POOL_005);
    await (nvda.connect(poolSigner) as any).transfer(user.address, ethers.parseEther("2"));
    expect(await nvda.balanceOf(user.address)).to.eq(ethers.parseEther("2"));

    // 2. deploy the factory
    const Factory = await ethers.getContractFactory("PayoffVaultFactory", deployer);
    const factory = await Factory.deploy(MORPHO, NFPM, ROUTER, UNI_FACTORY, treasury.address, 250, 1000);

    // 3. resolve the two markets from the chain (params by id prefix from the snapshot list)
    const snapshot = (await import("../../lib/morpho-markets.json")).default as any;
    const findId = (prefix: string) => snapshot.markets.find((m: any) => m.id.startsWith(prefix)).id as string;
    const idA = findId(MARKET_A);
    const idB = findId(MARKET_B);
    const paramsOf = async (id: string) => { const p = await morpho.idToMarketParams(id); return { loanToken: p[0], collateralToken: p[1], oracle: p[2], irm: p[3], lltv: p[4] }; };
    const mA = await paramsOf(idA);
    const mB = await paramsOf(idB);
    expect(mA.collateralToken.toLowerCase()).to.eq(NVDA.toLowerCase());
    expect(mB.loanToken.toLowerCase()).to.eq(USDG.toLowerCase());

    // 4. create the vault: borrow to 20%, protect at 30% (below market B's 38.5% LLTV)
    const policy = { maxLtvBps: 2000n, triggerLtvBps: 3000n, repayBps: 2500n, maxSlippageBps: 100n };
    const tx = await factory.connect(user).createVault(operator.address, mA, policy, [500]);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l) => { try { return factory.interface.parseLog(l as any); } catch { return null; } }).find((e) => e?.name === "VaultCreated");
    const vault = await ethers.getContractAt("PayoffVault", ev!.args.vault);
    const vaultAddr = await vault.getAddress();
    await vault.connect(user).setMarketAllowed(mB, true);

    // 5. deposit 1 NVDA, borrow 40 USDG (LTV ~18% at ~$225)
    await nvda.approve(vaultAddr, ethers.MaxUint256);
    await vault.connect(user).depositCollateral(ethers.parseEther("1"));
    expect(await vault.collateralAssets()).to.eq(ethers.parseEther("1"));
    const oracle = await vault.oraclePrice();
    expect(oracle).to.be.gt(0n);
    await vault.connect(operator).borrow(40_000_000n);
    // Morpho rounds borrow shares -> assets up: at most one unit above what was borrowed.
    expect(await vault.debtAssets()).to.be.within(40_000_000n, 40_000_001n);
    const ltv = await vault.ltvBps();
    expect(ltv).to.be.lt(2000n);
    expect(await usdg.balanceOf(vaultAddr)).to.eq(40_000_000n);

    // 6. open a ±5% position in the 0.05% pool with the 40 USDG (half swapped to NVDA)
    const pool = new ethers.Contract(NVDA_POOL_005, POOL_ABI, user);
    const [, tick] = await pool.slot0();
    const spacing = Number(await pool.tickSpacing());
    const width = Math.round(Math.log(1.05) / Math.log(1.0001));
    const tickLower = Math.floor((Number(tick) - width) / spacing) * spacing;
    const tickUpper = Math.ceil((Number(tick) + width) / spacing) * spacing;
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 600;
    const open = await vault.connect(operator).openLp({ fee: 500, tickLower, tickUpper, loanAmount: 40_000_000n, swapAmount: 20_000_000n, swapMinOut: 0n, amount0Min: 0n, amount1Min: 0n, deadline });
    await open.wait();
    const ids = await vault.openPositions();
    expect(ids.length).to.eq(1);
    const info = await vault.positionInfo(ids[0]);
    // Cost basis is what the position took, not what was offered: the real manager
    // returns the leg it could not use, so the basis lands a little under the 40 USDG.
    expect(info.costBasis).to.be.lte(40_000_000n);
    expect(info.costBasis).to.be.gte(39_000_000n);

    // 7. refinance the debt into market B via Morpho's flash loan
    await expect(vault.connect(operator).refinance(mB)).to.emit(vault, "Refinanced");
    const posA = await morpho.position(idA, vaultAddr);
    const posB = await morpho.position(idB, vaultAddr);
    expect(posA.borrowShares).to.eq(0n);
    expect(posA.collateral).to.eq(0n);
    expect(posB.collateral).to.eq(ethers.parseEther("1"));
    expect(await vault.currentMarketId()).to.eq(idB);
    const debtAfter = await vault.debtAssets();
    expect(debtAfter).to.be.gte(40_000_000n);
    expect(debtAfter).to.be.lt(40_100_000n);

    // 8. close the position into USDG and repay; the leftover (if any) stays in the vault for the owner
    const close = await vault.connect(operator).closeLp(ids[0], 0n, 0n, true, 0n, deadline);
    await close.wait();
    expect((await vault.openPositions()).length).to.eq(0);
    const debtLeft = await vault.debtAssets();
    const idle = await usdg.balanceOf(vaultAddr);
    // the round trip through the pool costs the swap fee twice plus slippage: a few cents on $40
    expect(Number(debtLeft) + Number(idle)).to.be.lt(1_000_000); // < 1 USDG apart from zero one way or the other
    console.log(`      after close: debt ${ethers.formatUnits(debtLeft, 6)} USDG, idle ${ethers.formatUnits(idle, 6)} USDG, repaid ${ethers.formatUnits(await vault.totalRepaid(), 6)} USDG, oracle ${ethers.formatUnits(oracle, 24)} USDG/NVDA`);

    // 9. the owner tops up the dust (1 USDG borrowed from the pool by impersonation), repays, and takes the collateral back
    await (usdg.connect(poolSigner) as any).transfer(user.address, 1_000_000n);
    await usdg.approve(vaultAddr, ethers.MaxUint256);
    await vault.connect(user).depositLoanToken(1_000_000n);
    await vault.connect(user).repay(0n);
    expect(await vault.debtAssets()).to.eq(0n);
    await vault.connect(user).withdrawCollateral(ethers.parseEther("1"));
    expect(await nvda.balanceOf(user.address)).to.eq(ethers.parseEther("2"));
    // whatever USDG is left over is the owner's to sweep
    await vault.connect(user).withdrawToken(USDG, 0n);
    expect(await usdg.balanceOf(vaultAddr)).to.eq(0n);
    expect(await usdg.balanceOf(user.address)).to.be.gt(0n);
  });
});
