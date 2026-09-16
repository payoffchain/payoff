import { describe, expect, it } from "vitest";
import { allMarkets, marketById, marketIdOf, marketsForPair, ratePerSecondToApy, sharesToAssetsUp } from "@/lib/morpho";
import { tokenMeta } from "@/lib/tokenmeta";
import snapshot from "@/lib/morpho-markets.json";

describe("morpho helpers", () => {
  it("computes the same market id Morpho does for every snapshot market", () => {
    // Guards against a wrong field order in the encoding: every id in the snapshot came from the API.
    let checked = 0;
    for (const m of snapshot.markets) {
      if (!m.oracle) continue;
      expect(marketIdOf({ loanToken: m.loanToken, collateralToken: m.collateralToken, oracle: m.oracle, irm: m.irm, lltv: m.lltv }).toLowerCase()).toBe(m.id.toLowerCase());
      checked++;
    }
    // Arc is days old: a handful of markets today, more as curators arrive
    expect(checked).toBeGreaterThan(5);
  });

  it("turns a per-second rate into an APY with continuous compounding", () => {
    // 5% APR continuously compounded ≈ 5.127% APY
    const perSecond = BigInt(Math.round((0.05 / (365 * 24 * 3600)) * 1e18));
    expect(ratePerSecondToApy(perSecond)).toBeCloseTo(0.05127, 4);
    expect(ratePerSecondToApy(0n)).toBe(0);
  });

  it("rounds borrow shares to assets up, like Morpho", () => {
    // 1e6 virtual shares, 1 virtual asset: 1 share of a fresh market is worth ~1e-6 asset, rounded up to 1
    expect(sharesToAssetsUp(1n, 0n, 0n)).toBe(1n);
    // 900e6 assets borrowed as 900e12 shares (first borrow): converts back exactly
    expect(sharesToAssetsUp(900_000_000_000_000n, 900_000_000n, 900_000_000_000_000n)).toBe(900_000_000n);
  });

  it("groups USDC markets by pair and finds them by id", () => {
    const all = allMarkets();
    expect(all.length).toBeGreaterThan(3);
    expect(all.every((m) => m.loan.symbol === "USDC")).toBe(true);
    const btc = all.find((m) => m.collateral.symbol === "cirBTC")!;
    const pair = marketsForPair(btc.params.collateralToken, btc.params.loanToken);
    expect(pair.length).toBeGreaterThan(1);
    expect(pair.every((m) => m.collateral.symbol === "cirBTC")).toBe(true);
    expect(marketById(btc.id)?.id).toBe(btc.id);
    expect(marketById("0x" + "0".repeat(64))).toBeNull();
  });

  it("knows featured collateral from the registry and other tokens from the snapshot", () => {
    const btc = tokenMeta("0x171A4217b86A807A64eB94757Db6849fb4bDbAA0");
    expect(btc?.symbol).toBe("cirBTC");
    expect(btc?.isStock).toBe(true);
    expect(btc?.decimals).toBe(8);
    const usdc = tokenMeta("0x3600000000000000000000000000000000000000");
    expect(usdc?.symbol).toBe("USDC");
    expect(usdc?.decimals).toBe(6);
    expect(tokenMeta("0x0000000000000000000000000000000000000001")).toBeNull();
  });
});
