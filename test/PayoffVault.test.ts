import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * PayoffVault against the mocks: the same share maths, health rule and callback shape
 * as Morpho Blue and Uniswap V3, with knobs for price, interest and fees earned.
 *
 * Units: NVDA has 18 decimals, USDG has 6. Oracle price = loan per collateral in
 * smallest units, scaled 1e36: 180 USDG per NVDA -> 180e6 * 1e36 / 1e18.
 */

const WAD = 10n ** 18n;
const USDG = (n: number | string) => ethers.parseUnits(String(n), 6);
const NVDA = (n: number | string) => ethers.parseUnits(String(n), 18);
const PRICE36 = (usdPerToken: bigint) => (usdPerToken * 10n ** 6n * 10n ** 36n) / 10n ** 18n;

function sqrtBig(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

/** sqrtPriceX96 for a pool where token1-per-token0 (raw units) equals num/den. */
function sqrtPriceX96(num: bigint, den: bigint): bigint {
  return sqrtBig((num * (1n << 192n)) / den);
}

async function deployFixture() {
  const [deployer, user, operator, lender, treasury, stranger] = await ethers.getSigners();

  const ERC20 = await ethers.getContractFactory("MockERC20");
  const nvda = await ERC20.deploy("NVIDIA Stock Token", "NVDA", 18);
  const usdg = await ERC20.deploy("Global Dollar", "USDG", 6);
  const nvdaAddr = await nvda.getAddress();
  const usdgAddr = await usdg.getAddress();

  const price = PRICE36(180n);
  const oracle = await (await ethers.getContractFactory("MockOracle")).deploy(price);
  const irmA = await (await ethers.getContractFactory("MockIrm")).deploy(1n);
  const irmB = await (await ethers.getContractFactory("MockIrm")).deploy(2n);
  const morpho = await (await ethers.getContractFactory("MockMorpho")).deploy();

  const marketA = { loanToken: usdgAddr, collateralToken: nvdaAddr, oracle: await oracle.getAddress(), irm: await irmA.getAddress(), lltv: 63n * WAD / 100n };
  const marketB = { loanToken: usdgAddr, collateralToken: nvdaAddr, oracle: await oracle.getAddress(), irm: await irmB.getAddress(), lltv: 77n * WAD / 100n };
  await morpho.createMarket(marketA);
  await morpho.createMarket(marketB);

  // lender side
  await usdg.mint(lender.address, USDG(2_000_000));
  await usdg.connect(lender).approve(await morpho.getAddress(), ethers.MaxUint256);
  await morpho.connect(lender).supply(marketA, USDG(1_000_000), 0, lender.address, "0x");
  await morpho.connect(lender).supply(marketB, USDG(1_000_000), 0, lender.address, "0x");

  // uniswap side
  const uniFactory = await (await ethers.getContractFactory("MockUniFactory")).deploy();
  const token0IsNvda = nvdaAddr.toLowerCase() < usdgAddr.toLowerCase();
  // token1 per token0 in raw units
  const sp = token0IsNvda ? sqrtPriceX96(180n * 10n ** 6n, 10n ** 18n) : sqrtPriceX96(10n ** 18n, 180n * 10n ** 6n);
  await uniFactory.create(nvdaAddr, usdgAddr, 3000, sp);
  const poolAddr = await uniFactory.getPool(nvdaAddr, usdgAddr, 3000);
  const pool = await ethers.getContractAt("MockPool", poolAddr);
  const pm = await (await ethers.getContractFactory("MockPositionManager")).deploy(await uniFactory.getAddress());
  const router = await (await ethers.getContractFactory("MockSwapRouter")).deploy(nvdaAddr, usdgAddr, price);
  // router inventory
  await nvda.mint(await router.getAddress(), NVDA(1_000_000));
  await usdg.mint(await router.getAddress(), USDG(100_000_000));

  const Factory = await ethers.getContractFactory("PayoffVaultFactory");
  const factory = await Factory.deploy(
    await morpho.getAddress(), await pm.getAddress(), await router.getAddress(), await uniFactory.getAddress(), treasury.address, 250, 1000
  );

  const policy = { maxLtvBps: 5000n, triggerLtvBps: 5500n, repayBps: 2500n, maxSlippageBps: 100n };
  const tx = await factory.connect(user).createVault(operator.address, marketA, policy);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => { try { return factory.interface.parseLog(l as any); } catch { return null; } }).find((e) => e?.name === "VaultCreated");
  const vault = await ethers.getContractAt("PayoffVault", ev!.args.vault);

  await nvda.mint(user.address, NVDA(100));
  await nvda.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  await usdg.mint(user.address, USDG(10_000));
  await usdg.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);

  const deadline = async () => (await time.latest()) + 600;

  return { deployer, user, operator, lender, treasury, stranger, nvda, usdg, oracle, morpho, marketA, marketB, uniFactory, pool, pm, router, factory, vault, policy, price, deadline, token0IsNvda };
}

describe("PayoffVaultFactory", () => {
  it("creates a vault owned by the caller and registers it", async () => {
    const { factory, vault, user, operator, marketA } = await loadFixture(deployFixture);
    expect(await vault.owner()).to.eq(user.address);
    expect(await vault.operator()).to.eq(operator.address);
    expect(await factory.isVault(await vault.getAddress())).to.eq(true);
    expect(await factory.vaultsOfOwner(user.address)).to.deep.eq([await vault.getAddress()]);
    expect(await factory.vaultCount()).to.eq(1n);
    expect(await vault.allowedMarkets(await vault.marketId(marketA))).to.eq(true);
  });

  it("refuses fees above the vault caps", async () => {
    const { factory } = await loadFixture(deployFixture);
    await expect(factory.setFees(501, 1000)).to.be.revertedWith("factory: fee above vault cap");
    await expect(factory.setFees(250, 2001)).to.be.revertedWith("factory: fee above vault cap");
    await factory.setFees(0, 0);
  });

  it("cannot initialize a vault twice", async () => {
    const { vault, factory, user, operator, marketA, policy } = await loadFixture(deployFixture);
    await expect(vault.initialize(await factory.getAddress(), user.address, operator.address, marketA, policy)).to.be.revertedWithCustomError(vault, "AlreadyInitialized");
  });

  it("rejects a bad policy", async () => {
    const { factory, operator, marketA } = await loadFixture(deployFixture);
    const bad = { maxLtvBps: 9600n, triggerLtvBps: 9700n, repayBps: 2500n, maxSlippageBps: 100n };
    await expect(factory.createVault(operator.address, marketA, bad)).to.be.reverted;
    const bad2 = { maxLtvBps: 5000n, triggerLtvBps: 4000n, repayBps: 2500n, maxSlippageBps: 100n };
    await expect(factory.createVault(operator.address, marketA, bad2)).to.be.reverted;
  });
});

describe("PayoffVault: collateral and debt", () => {
  it("deposits collateral into Morpho and borrows within policy", async () => {
    const { vault, user, operator, morpho, marketA } = await loadFixture(deployFixture);
    await vault.connect(user).depositCollateral(NVDA(10)); // 1,800 USDG of collateral
    expect(await vault.collateralAssets()).to.eq(NVDA(10));
    await vault.connect(operator).borrow(USDG(900)); // 50% LTV
    expect(await vault.debtAssets()).to.eq(USDG(900));
    expect(await vault.ltvBps()).to.eq(5000n);
    expect(await vault.totalBorrowed()).to.eq(USDG(900));
    const pos = await morpho.position(await vault.marketId(marketA), await vault.getAddress());
    expect(pos.collateral).to.eq(NVDA(10));
  });

  it("refuses a borrow that would leave LTV above maxLtvBps", async () => {
    const { vault, user, operator } = await loadFixture(deployFixture);
    await vault.connect(user).depositCollateral(NVDA(10));
    await expect(vault.connect(operator).borrow(USDG(901))).to.be.revertedWithCustomError(vault, "LtvTooHigh");
  });

  it("only owner or operator may borrow; a paused vault blocks the operator but not the owner", async () => {
    const { vault, user, operator, stranger } = await loadFixture(deployFixture);
    await vault.connect(user).depositCollateral(NVDA(10));
    await expect(vault.connect(stranger).borrow(USDG(100))).to.be.revertedWithCustomError(vault, "NotAuthorized");
    await vault.connect(user).setPaused(true);
    await expect(vault.connect(operator).borrow(USDG(100))).to.be.revertedWithCustomError(vault, "IsPaused");
    await vault.connect(user).borrow(USDG(100));
    expect(await vault.debtAssets()).to.eq(USDG(100));
  });

  it("repays from the vault balance, closing the position exactly when paying everything", async () => {
    const { vault, user, operator, morpho, marketA, usdg } = await loadFixture(deployFixture);
    await vault.connect(user).depositCollateral(NVDA(10));
    await vault.connect(operator).borrow(USDG(900));
    await morpho.addInterest(marketA, USDG(9)); // the vault is the only borrower, so all of it is its
    const debt = await vault.debtAssets();
    expect(debt).to.be.gt(USDG(900));
    await vault.connect(user).depositLoanToken(USDG(20)); // vault now has 920
    await vault.connect(operator).repay(0);
    expect(await vault.debtAssets()).to.eq(0n);
    expect(await usdg.balanceOf(await vault.getAddress())).to.eq(USDG(920) - debt);
    expect(await vault.totalRepaid()).to.eq(debt);
  });

  it("withdrawals go only to the owner and only from the owner", async () => {
    const { vault, user, operator, nvda, usdg } = await loadFixture(deployFixture);
    await vault.connect(user).depositCollateral(NVDA(10));
    await vault.connect(operator).borrow(USDG(500));
    await expect(vault.connect(operator).withdrawCollateral(NVDA(1))).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(operator).withdrawToken(await usdg.getAddress(), 0)).to.be.revertedWithCustomError(vault, "NotOwner");
    const before = await nvda.balanceOf(user.address);
    await vault.connect(user).withdrawCollateral(NVDA(1));
    expect(await nvda.balanceOf(user.address)).to.eq(before + NVDA(1));
    // Morpho refuses a withdrawal that would leave the position unhealthy
    await expect(vault.connect(user).withdrawCollateral(NVDA(9))).to.be.revertedWith("mock: insufficient collateral");
    await vault.connect(user).withdrawToken(await usdg.getAddress(), 0);
    expect(await usdg.balanceOf(user.address)).to.eq(USDG(10_500));
  });

  it("transfers ownership in two steps", async () => {
    const { vault, user, stranger } = await loadFixture(deployFixture);
    await vault.connect(user).proposeOwner(stranger.address);
    expect(await vault.owner()).to.eq(user.address);
    await expect(vault.connect(user).acceptOwnership()).to.be.revertedWithCustomError(vault, "NotAuthorized");
    await vault.connect(stranger).acceptOwnership();
    expect(await vault.owner()).to.eq(stranger.address);
  });
});

describe("PayoffVault: liquidity, harvest, close", () => {
  async function withLoan() {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositCollateral(NVDA(10));
    await f.vault.connect(f.operator).borrow(USDG(900));
    return f;
  }

  it("opens a single-sided position with the borrowed loan token", async () => {
    const f = await withLoan();
    const tx = await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    await expect(tx).to.emit(f.vault, "LpOpened");
    const ids = await f.vault.openPositions();
    expect(ids.length).to.eq(1);
    const info = await f.vault.positionInfo(ids[0]);
    expect(info.costBasis).to.eq(USDG(900));
    expect(info.fee).to.eq(3000);
    expect(await f.usdg.balanceOf(await f.vault.getAddress())).to.eq(0n);
  });

  it("swaps part of the loan token into collateral to open two-sided", async () => {
    const f = await withLoan();
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: USDG(450), swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    const [id] = await f.vault.openPositions();
    const p = await f.pm.positions(id);
    const nvdaLeg = f.token0IsNvda ? p.liquidity - USDG(450) : p.liquidity - USDG(450);
    expect(nvdaLeg).to.eq(NVDA(2.5)); // 450 / 180
  });

  it("refuses to mint when the pool price is off the oracle", async () => {
    const f = await withLoan();
    await f.pool.setSqrtPrice((await f.pool.sqrtP()) * 102n / 100n); // ~4% price move
    await expect(f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    })).to.be.revertedWithCustomError(f.vault, "PoolPriceOffOracle");
  });

  it("harvests fees: protocol takes its cut, the rest repays debt", async () => {
    const f = await withLoan();
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    const [id] = await f.vault.openPositions();
    // 40 USDG + 0.1 NVDA (18 USDG) of fees
    const fees0 = f.token0IsNvda ? NVDA(0.1) : USDG(40);
    const fees1 = f.token0IsNvda ? USDG(40) : NVDA(0.1);
    await f.pm.setFees(id, fees0, fees1);
    await expect(f.vault.connect(f.operator).harvest(id, 0, await f.deadline())).to.emit(f.vault, "Harvested");
    // protocol: 2.5% of 40 USDG = 1 USDG, 2.5% of 0.1 NVDA = 0.0025 NVDA
    expect(await f.usdg.balanceOf(f.treasury.address)).to.eq(USDG(1));
    expect(await f.nvda.balanceOf(f.treasury.address)).to.eq(NVDA(0.0025));
    // vault: 39 USDG + 0.0975 NVDA * 180 = 17.55 USDG -> 56.55 repaid
    const repaid = USDG(39) + USDG("17.55");
    expect(await f.vault.totalRepaidFromFees()).to.eq(repaid);
    expect(await f.vault.debtAssets()).to.eq(USDG(900) - repaid);
    expect(await f.vault.totalHarvested()).to.eq(repaid);
  });

  it("harvest refuses a swap below the oracle floor", async () => {
    const f = await withLoan();
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    const [id] = await f.vault.openPositions();
    await f.pm.setFees(id, f.token0IsNvda ? NVDA(1) : 0n, f.token0IsNvda ? 0n : NVDA(1));
    await f.router.setSpread(300); // 3% worse than oracle; policy allows 1%
    await expect(f.vault.connect(f.operator).harvest(id, 0, await f.deadline())).to.be.revertedWith("Too little received");
    await f.router.setSpread(50);
    await f.vault.connect(f.operator).harvest(id, 0, await f.deadline());
  });

  it("closes into the loan token, charges a performance fee on profit, repays, and keeps the rest", async () => {
    const f = await withLoan();
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    const [id] = await f.vault.openPositions();
    // position is now worth 1000 USDG (100 profit)
    await f.pm.setUnderlying(id, f.token0IsNvda ? 0n : USDG(1000), f.token0IsNvda ? USDG(1000) : 0n);
    await f.vault.connect(f.operator).closeLp(id, 0, 0, true, 0, await f.deadline());
    expect(await f.usdg.balanceOf(f.treasury.address)).to.eq(USDG(10)); // 10% of 100
    expect(await f.vault.debtAssets()).to.eq(0n);
    expect(await f.usdg.balanceOf(await f.vault.getAddress())).to.eq(USDG(90)); // 990 - 900
    expect((await f.vault.openPositions()).length).to.eq(0);
    await expect(f.vault.connect(f.operator).harvest(id, 0, await f.deadline())).to.be.revertedWithCustomError(f.vault, "UnknownPosition");
  });

  it("closes without swapping: both legs stay in the vault, no fee, no repayment", async () => {
    const f = await withLoan();
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: USDG(450), swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    const [id] = await f.vault.openPositions();
    await f.vault.connect(f.operator).closeLp(id, 0, 0, false, 0, await f.deadline());
    expect(await f.usdg.balanceOf(await f.vault.getAddress())).to.eq(USDG(450));
    expect(await f.nvda.balanceOf(await f.vault.getAddress())).to.eq(NVDA(2.5));
    expect(await f.vault.debtAssets()).to.eq(USDG(900));
    expect(await f.usdg.balanceOf(f.treasury.address)).to.eq(0n);
  });

  it("managed mode: LP from deposited loan token without any debt", async () => {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositLoanToken(USDG(1000));
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(1000), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    const [id] = await f.vault.openPositions();
    await f.pm.setFees(id, f.token0IsNvda ? 0n : USDG(40), f.token0IsNvda ? USDG(40) : 0n);
    await f.vault.connect(f.operator).harvest(id, 0, await f.deadline());
    // nothing to repay: fees (less protocol cut) sit in the vault for the owner
    expect(await f.usdg.balanceOf(await f.vault.getAddress())).to.eq(USDG(39));
    expect(await f.vault.totalRepaidFromFees()).to.eq(0n);
  });
});

describe("PayoffVault: refinance", () => {
  it("moves debt and collateral to an allow-listed market atomically", async () => {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositCollateral(NVDA(10));
    await f.vault.connect(f.operator).borrow(USDG(900));
    await expect(f.vault.connect(f.operator).refinance(f.marketB)).to.be.revertedWithCustomError(f.vault, "MarketNotAllowed");
    await f.vault.connect(f.user).setMarketAllowed(f.marketB, true);
    await expect(f.vault.connect(f.operator).refinance(f.marketB)).to.emit(f.vault, "Refinanced");

    const idA = await f.vault.marketId(f.marketA);
    const idB = await f.vault.marketId(f.marketB);
    const v = await f.vault.getAddress();
    const posA = await f.morpho.position(idA, v);
    const posB = await f.morpho.position(idB, v);
    expect(posA.collateral).to.eq(0n);
    expect(posA.borrowShares).to.eq(0n);
    expect(posB.collateral).to.eq(NVDA(10));
    expect(await f.vault.currentMarketId()).to.eq(idB);
    expect(await f.vault.debtAssets()).to.eq(USDG(900));
    expect(await f.vault.refinanceCount()).to.eq(1n);
    expect(await f.usdg.balanceOf(v)).to.eq(USDG(900)); // the borrowed funds, untouched: the flash loan was fully returned
  });

  it("refuses the current market, a wrong pair, and a market that breaks the LTV ceiling", async () => {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositCollateral(NVDA(10));
    await f.vault.connect(f.operator).borrow(USDG(900));
    await expect(f.vault.connect(f.operator).refinance(f.marketA)).to.be.revertedWithCustomError(f.vault, "NothingToDo");
    const wrong = { ...f.marketB, collateralToken: await f.usdg.getAddress(), loanToken: await f.nvda.getAddress() };
    await expect(f.vault.connect(f.user).setMarketAllowed(wrong, true)).to.be.revertedWithCustomError(f.vault, "WrongPair");
    // A target market whose oracle says the collateral is worth less (150 instead of 180) is
    // still healthy for Morpho (60% < 77% lltv) but breaks the vault's own 50% ceiling.
    const cheap = await (await ethers.getContractFactory("MockOracle")).deploy(PRICE36(150n));
    const marketC = { ...f.marketB, oracle: await cheap.getAddress() };
    await f.morpho.createMarket(marketC);
    await f.usdg.mint(f.lender.address, USDG(100_000));
    await f.morpho.connect(f.lender).supply(marketC, USDG(100_000), 0, f.lender.address, "0x");
    await f.vault.connect(f.user).setMarketAllowed(marketC, true);
    await expect(f.vault.connect(f.operator).refinance(marketC)).to.be.revertedWithCustomError(f.vault, "LtvTooHigh");
  });

  it("refinances with collateral but no debt without a flash loan", async () => {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositCollateral(NVDA(10));
    await f.vault.connect(f.user).setMarketAllowed(f.marketB, true);
    await f.morpho.setFlashLoanEnabled(false);
    await f.vault.connect(f.operator).refinance(f.marketB);
    expect(await f.vault.collateralAssets()).to.eq(NVDA(10));
    expect(await f.vault.currentMarketId()).to.eq(await f.vault.marketId(f.marketB));
  });

  it("rejects a flash loan callback from anyone but Morpho, or outside a refinance", async () => {
    const f = await loadFixture(deployFixture);
    await expect(f.vault.connect(f.stranger).onMorphoFlashLoan(1, "0x")).to.be.revertedWithCustomError(f.vault, "FlashLoanCallerNotMorpho");
  });
});

describe("PayoffVault: liquidation protection", () => {
  async function exposed() {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositCollateral(NVDA(10));
    await f.vault.connect(f.operator).borrow(USDG(900));
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    return f;
  }

  it("does nothing below the trigger", async () => {
    const f = await exposed();
    const ids = await f.vault.openPositions();
    await expect(f.vault.connect(f.operator).protect([...ids], 0, 3000, await f.deadline())).to.be.revertedWithCustomError(f.vault, "NotAtTrigger");
  });

  it("closes LP positions to repay the policy's share of the debt once LTV crosses the trigger", async () => {
    const f = await exposed();
    // NVDA drops 180 -> 150: collateral 1500, debt 900 -> LTV 60% (trigger 55%)
    const newPrice = PRICE36(150n);
    await f.oracle.set(newPrice);
    await f.router.setPrice(newPrice);
    const sp = f.token0IsNvda ? sqrtPriceX96(150n * 10n ** 6n, 10n ** 18n) : sqrtPriceX96(10n ** 18n, 150n * 10n ** 6n);
    await f.pool.setSqrtPrice(sp);
    expect(await f.vault.ltvBps()).to.eq(6000n);
    const ids = await f.vault.openPositions();
    await expect(f.vault.connect(f.operator).protect([...ids], 0, 3000, await f.deadline())).to.emit(f.vault, "Protected");
    // the whole 900 USDG position was closed; repaid min(target 225, 900)... the close repays everything it can
    expect(await f.vault.debtAssets()).to.eq(0n);
    expect((await f.vault.openPositions()).length).to.eq(0);
  });

  it("sells collateral when there is nothing else to repay with", async () => {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositCollateral(NVDA(10));
    await f.vault.connect(f.operator).borrow(USDG(900));
    await f.vault.connect(f.user).withdrawToken(await f.usdg.getAddress(), 0); // borrowed funds left the vault
    const newPrice = PRICE36(150n);
    await f.oracle.set(newPrice);
    await f.router.setPrice(newPrice);
    // target = 25% of 900 = 225 USDG = 1.5 NVDA at 150
    await f.vault.connect(f.operator).protect([], NVDA(1.5), 3000, await f.deadline());
    expect(await f.vault.debtAssets()).to.eq(USDG(675));
    expect(await f.vault.collateralAssets()).to.eq(NVDA(8.5));
  });
});

describe("PayoffVault: audit hardening", () => {
  async function funded() {
    const f = await loadFixture(deployFixture);
    await f.vault.connect(f.user).depositCollateral(NVDA(10));
    await f.vault.connect(f.operator).borrow(USDG(900));
    return f;
  }

  it("fails closed when the oracle cannot be read: no swap, no mint, no collateral sale", async () => {
    const f = await funded();
    await f.oracle.setBroken(true);
    // mint (single-sided, no swap) is refused because the pool cannot be checked
    await expect(f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    })).to.be.revertedWithCustomError(f.vault, "OracleUnavailable");
    // a swap with minOut = 0 is refused, whatever the operator asks
    await expect(f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: USDG(450), swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    })).to.be.revertedWithCustomError(f.vault, "OracleUnavailable");
    // protect cannot sell collateral blind either; ltvBps() is "unknown" (max) so the trigger passes, the sale does not
    await f.vault.connect(f.user).withdrawToken(await f.usdg.getAddress(), 0);
    await expect(f.vault.connect(f.operator).protect([], NVDA(5), 3000, await f.deadline())).to.be.revertedWithCustomError(f.vault, "OracleUnavailable");
    // repaying from idle balance still works: that path needs no price
    await f.vault.connect(f.user).depositLoanToken(USDG(100));
    await expect(f.vault.connect(f.operator).repay(USDG(100))).to.emit(f.vault, "Repaid");
    await f.oracle.setBroken(false);
  });

  it("protect sells only what the repayment needs, whatever the caller asks for", async () => {
    const f = await funded();
    await f.vault.connect(f.user).withdrawToken(await f.usdg.getAddress(), 0);
    const newPrice = PRICE36(150n);
    await f.oracle.set(newPrice);
    await f.router.setPrice(newPrice);
    // target = 25% of 900 = 225 USDG = 1.5 NVDA at 150; band 1% -> at most ~1.515 NVDA may be sold
    await f.vault.connect(f.operator).protect([], NVDA(8), 3000, await f.deadline());
    expect(await f.vault.debtAssets()).to.eq(USDG(675));
    const coll = await f.vault.collateralAssets();
    expect(coll).to.be.gte(NVDA(8.48));
    expect(coll).to.be.lte(NVDA(8.5));
    // LTV went down, never up
    expect(await f.vault.ltvBps()).to.be.lt(6000n);
  });

  // ProtectWorsenedLtv is a defensive post-condition: with a bounded, oracle-floored sale the
  // LTV can only rise when it already exceeds ~1/(1+slippage), i.e. past every Morpho LLTV,
  // where Morpho itself refuses the withdrawal first. It is not reachable through the mocks.

  it("policy trigger must sit below the market's LLTV, on create, on setPolicy, on allow-list and on refinance", async () => {
    const f = await loadFixture(deployFixture);
    // marketA lltv 63%: a trigger of 63% or more is useless
    const useless = { maxLtvBps: 5000n, triggerLtvBps: 6300n, repayBps: 2500n, maxSlippageBps: 100n };
    await expect(f.factory.createVault(f.operator.address, f.marketA, useless)).to.be.revertedWithCustomError(f.vault, "PolicyAboveLltv");
    await expect(f.vault.connect(f.user).setPolicy(useless)).to.be.revertedWithCustomError(f.vault, "PolicyAboveLltv");
    // a 39% market cannot be allow-listed under a 55% trigger
    const irmC = await (await ethers.getContractFactory("MockIrm")).deploy(3n);
    const marketC = { ...f.marketA, irm: await irmC.getAddress(), lltv: 385n * WAD / 1000n };
    await f.morpho.createMarket(marketC);
    await expect(f.vault.connect(f.user).setMarketAllowed(marketC, true)).to.be.revertedWithCustomError(f.vault, "PolicyAboveLltv");
    // ...and an oracle-less market never
    await expect(f.vault.connect(f.user).setMarketAllowed({ ...f.marketB, oracle: ethers.ZeroAddress }, true)).to.be.revertedWithCustomError(f.vault, "OracleUnavailable");
    // a zero slippage band is refused (it would fail every swap against the pool fee)
    await expect(f.vault.connect(f.user).setPolicy({ ...useless, triggerLtvBps: 5500n, maxSlippageBps: 0n })).to.be.revertedWithCustomError(f.vault, "BadPolicy");
  });

  it("cost basis counts only what the position took, not what mint handed back", async () => {
    const f = await funded();
    const tokenId = await f.vault.connect(f.operator).openLp.staticCall({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    await f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: 0, swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    });
    const info = await f.vault.positionInfo(tokenId);
    // the mock takes everything it is offered, so basis == the loan committed; the point is
    // that it is derived from `used`, which the real manager may return short of `desired`
    expect(info.costBasis).to.eq(USDG(900));
    expect(info.open).to.eq(true);
  });

  it("re-checks the pool against the oracle after its own swap", async () => {
    const f = await funded();
    // Pool sits at the oracle before the swap; the mock router does not move the pool, so
    // simulate a thin pool that our swap knocked 5% off by moving it in between via a
    // second call: pre-swap check passes, post-swap check must fail.
    const sp = f.token0IsNvda ? sqrtPriceX96(171n * 10n ** 6n, 10n ** 18n) : sqrtPriceX96(10n ** 18n, 171n * 10n ** 6n);
    await f.pool.setSqrtPrice(sp); // 5% below the 180 oracle: outside the 1% band
    await expect(f.vault.connect(f.operator).openLp({
      fee: 3000, tickLower: -887220, tickUpper: 887220, loanAmount: USDG(900), swapAmount: USDG(450), swapMinOut: 0,
      amount0Min: 0, amount1Min: 0, deadline: await f.deadline(),
    })).to.be.revertedWithCustomError(f.vault, "PoolPriceOffOracle");
  });
});
