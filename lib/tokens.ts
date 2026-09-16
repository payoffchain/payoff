import { ethers } from "ethers";
import { getProvider } from "./chain";

/**
 * Token decimals, and amount parsing that respects them.
 *
 * AUDIT FIX (H4): the API used ethers.parseEther / formatEther for every token amount,
 * which hard-codes 18 decimals. On a 6-decimal token like USDC that is wrong by a factor
 * of 10^12 — and these numbers go straight into calldata that a wallet then signs, so
 * "deposit 100 USDC" became "deposit 100,000,000,000,000 USDC" and the transaction either
 * failed on allowance or, with enough allowance, did something nobody intended.
 *
 * AUDIT FIX (H5): USD amounts were converted with BigInt(Math.floor(Number(x) * 1e18)).
 * Float multiplication loses precision above ~9007 dollars, "1e30" becomes Infinity and
 * throws a RangeError that surfaced as an opaque 500, and negative values passed straight
 * through. usdScaled() below parses the decimal string directly.
 */

const ERC20_METADATA_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

/** Decimals are immutable for any sane ERC20, so one lookup per process is enough. */
const decimalsCache = new Map<string, number>();

export async function decimalsOf(token: string): Promise<number> {
  if (!ethers.isAddress(token)) throw new BadInput(`not a valid token address: ${token}`);
  const key = token.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;

  try {
    const erc20 = new ethers.Contract(token, ERC20_METADATA_ABI, getProvider());
    const d = Number(await erc20.decimals());
    if (!Number.isInteger(d) || d < 0 || d > 36) throw new Error("implausible decimals");
    decimalsCache.set(key, d);
    return d;
  } catch (err) {
    // decimals() is optional in ERC20, so a contract that reverts or returns nothing
    // gets the near-universal default. A network failure is NOT that case: caching 18
    // for USDC (6) after one RPC blip would corrupt every amount this process computes
    // for its whole life. Let the request fail instead.
    const code = (err as { code?: string } | null)?.code;
    if (code === "CALL_EXCEPTION" || code === "BAD_DATA") {
      decimalsCache.set(key, 18);
      return 18;
    }
    throw err;
  }
}

export class BadInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadInput";
  }
}

/** Parse a human-readable amount ("12.5") into raw units for `token`. */
export async function parseTokenAmount(token: string, amount: string | number): Promise<bigint> {
  const decimals = await decimalsOf(token);
  return parseDecimal(amount, decimals, "amount");
}

export async function formatTokenAmount(token: string, raw: bigint | string): Promise<string> {
  const decimals = await decimalsOf(token);
  return ethers.formatUnits(raw, decimals);
}

/** USD values are 1e18-scaled everywhere on-chain. */
export function usdScaled(amountUSD: string | number): bigint {
  return parseDecimal(amountUSD, 18, "amountUSD");
}

export function formatUsd(raw: bigint | string): string {
  return ethers.formatUnits(raw, 18);
}

/**
 * Strict decimal parsing. Rejects everything ethers.parseUnits would silently mangle or
 * throw an unhelpful error on: exponent notation, negatives, NaN, empty strings.
 */
export function parseDecimal(value: string | number, decimals: number, label = "value"): bigint {
  const s = typeof value === "number" ? numberToDecimalString(value, label) : String(value).trim();

  if (s === "") throw new BadInput(`${label} is required`);
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new BadInput(`${label} must be a positive decimal number without exponent notation, got "${s}"`);
  }
  const [, fraction = ""] = s.split(".");
  if (fraction.length > decimals) {
    throw new BadInput(`${label} has ${fraction.length} decimal places but the token allows ${decimals}`);
  }
  return boundUint256(ethers.parseUnits(s, decimals), label);
}

/** Largest value a Solidity uint256 can hold; anything above it cannot be ABI-encoded. */
export const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Reject a parsed amount that no uint256 argument could carry. Without this, ethers
 * throws NUMERIC_FAULT / INVALID_ARGUMENT at encode time and the caller sees a 500.
 */
export function boundUint256(v: bigint, label = "value"): bigint {
  if (v > MAX_UINT256) throw new BadInput(`${label} exceeds the maximum uint256 value`);
  return v;
}

function numberToDecimalString(value: number, label: string): string {
  if (!Number.isFinite(value)) throw new BadInput(`${label} must be a finite number`);
  if (value < 0) throw new BadInput(`${label} must not be negative`);
  // Numbers above 2^53 have already lost precision before reaching us; make the caller
  // send a string instead of silently accepting a rounded value.
  if (!Number.isSafeInteger(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new BadInput(`${label} is too large to pass as a number — send it as a string`);
  }
  const s = String(value);
  if (s.includes("e") || s.includes("E")) {
    throw new BadInput(`${label} must not use exponent notation — send it as a string`);
  }
  return s;
}

/** Raw units in, raw units out — no decimal assumption, for values already in base units. */
export function parseRawUnits(value: string | number, label = "value"): bigint {
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) throw new BadInput(`${label} must be a whole number of raw token units`);
  return boundUint256(BigInt(s), label);
}
