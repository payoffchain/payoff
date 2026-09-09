import { describe, expect, it } from "vitest";
import { alignTick, amountsForLiquidity, humanPrice, priceRawToTick, rangeAround, sortTokens, sqrtToPriceRaw, tickToPriceRaw, tickToSqrtPriceX96, MIN_TICK, MAX_TICK } from "@/lib/uniswap";

describe("tick maths", () => {
  it("round-trips price and tick", () => {
    for (const tick of [-200000, -60, 0, 60, 222170, 500000]) {
      const p = tickToPriceRaw(tick);
      expect(Math.abs(priceRawToTick(p) - tick)).toBeLessThanOrEqual(1);
    }
  });

  it("sqrtPriceX96 -> price agrees with tick -> price", () => {
    const tick = 222170; // NVDA/USDG 0.05% pool at the time of writing
    const s = tickToSqrtPriceX96(tick);
    const fromSqrt = sqrtToPriceRaw(s);
    const fromTick = tickToPriceRaw(tick);
    expect(Math.abs(fromSqrt / fromTick - 1)).toBeLessThan(1e-6);
  });

  it("humanPrice converts raw token1/token0 into loan per collateral either way round", () => {
    // NVDA (18 dec) as token0, USDG (6 dec) as token1: 225 USDG per NVDA = 225e6 / 1e18 raw
    const raw = (225 * 1e6) / 1e18;
    expect(humanPrice(raw, true, 18, 6)).toBeCloseTo(225, 6);
    // USDG as token0: raw = 1e18 / 225e6
    expect(humanPrice(1 / raw, false, 18, 6)).toBeCloseTo(225, 6);
  });

  it("aligns ticks to spacing and clamps to the bounds", () => {
    expect(alignTick(1234, 60, "down")).toBe(1200);
    expect(alignTick(1234, 60, "up")).toBe(1260);
    expect(alignTick(-1234, 60, "down")).toBe(-1260);
    expect(alignTick(-9999999, 60, "up")).toBe(MIN_TICK);
    expect(alignTick(9999999, 10, "down")).toBe(MAX_TICK);
  });

  it("builds a symmetric range around spot, full range for width 0", () => {
    const r = rangeAround(222170, 5, 500);
    expect(r.tickLower % 10).toBe(0);
    expect(r.tickUpper % 10).toBe(0);
    expect(r.tickLower).toBeLessThan(222170);
    expect(r.tickUpper).toBeGreaterThan(222170);
    // ±5% is ~488 ticks
    expect(r.tickUpper - r.tickLower).toBeGreaterThan(900);
    expect(r.tickUpper - r.tickLower).toBeLessThan(1000);
    const full = rangeAround(222170, 0, 3000);
    expect(full.tickLower).toBe(-887220);
    expect(full.tickUpper).toBe(887220);
    // a tiny width never collapses
    const tiny = rangeAround(0, 0.0001, 3000);
    expect(tiny.tickUpper).toBeGreaterThan(tiny.tickLower);
  });

  it("amountsForLiquidity is all token0 below the range, all token1 above, mixed inside", () => {
    const lower = 0, upper = 2000;
    const L = 1_000_000n;
    const below = amountsForLiquidity(L, tickToSqrtPriceX96(-100), lower, upper);
    expect(below.amount1).toBe(0);
    expect(below.amount0).toBeGreaterThan(0);
    const above = amountsForLiquidity(L, tickToSqrtPriceX96(3000), lower, upper);
    expect(above.amount0).toBe(0);
    expect(above.amount1).toBeGreaterThan(0);
    const inside = amountsForLiquidity(L, tickToSqrtPriceX96(1000), lower, upper);
    expect(inside.amount0).toBeGreaterThan(0);
    expect(inside.amount1).toBeGreaterThan(0);
  });

  it("sorts tokens by address, case-insensitively", () => {
    const [a, b] = sortTokens("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(a).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(b).toBe("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
  });
});
