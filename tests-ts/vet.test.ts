import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import VaultAbi from "../lib/abis/PayoffVault.json";
// @ts-expect-error plain ESM module without types
import { vetTx } from "../agent/vet.mjs";

/**
 * The runner's signing gate. A compromised site can return any {to, data, value}; this
 * is what stands between that and the operator key.
 */
const iface = new ethers.Interface(VaultAbi);
const VAULT = "0xBaAbdbe6847aD7930276A120225A8c41657eeD28";
const OTHER = "0x4581237a0B7359dbE36B3006CF72cf7Bd8c515f9";
const now = 1_800_000_000;
const dl = now + 1200;

const act = (kind: string, fn: string, args: unknown[], over: Record<string, unknown> = {}) => ({
  kind,
  built: { tx: { to: VAULT, data: iface.encodeFunctionData(fn, args), value: "0", description: "" }, deadline: dl, ...over },
});

describe("runner signing gate", () => {
  it("accepts each operator action addressed to the vault", () => {
    expect(vetTx(iface, VAULT, act("harvest", "harvest", [1n, 0n, dl]), now)).toBeNull();
    expect(vetTx(iface, VAULT, act("close", "closeLp", [1n, 0n, 0n, true, 0n, dl]), now)).toBeNull();
    expect(vetTx(iface, VAULT, act("protect", "protect", [[], 0n, 500, dl]), now)).toBeNull();
    expect(vetTx(iface, VAULT, act("open", "openLp", [[500, -100, 100, 1n, 0n, 0n, 0n, 0n, dl]]), now)).toBeNull();
    expect(vetTx(iface, VAULT, act("refinance", "refinance", [[OTHER, OTHER, OTHER, OTHER, 1n]]), now)).toBeNull();
  });

  it("refuses a transaction to any address but the vault", () => {
    const a = act("harvest", "harvest", [1n, 0n, dl]);
    a.built.tx.to = OTHER;
    expect(vetTx(iface, VAULT, a, now)).toMatch(/not the vault/);
  });

  it("refuses ETH value", () => {
    const a = act("harvest", "harvest", [1n, 0n, dl]);
    a.built.tx.value = "1";
    expect(vetTx(iface, VAULT, a, now)).toMatch(/value must be 0/);
    a.built.tx.value = "abc";
    expect(vetTx(iface, VAULT, a, now)).toMatch(/not a number/);
  });

  it("refuses owner-only functions even when the kind claims otherwise", () => {
    // withdrawToken is owner-only on chain, but the gate must not rely on the contract
    expect(vetTx(iface, VAULT, act("harvest", "withdrawToken", [OTHER, 0n]), now)).toMatch(/calldata is withdrawToken/);
    expect(vetTx(iface, VAULT, act("open", "setOperator", [OTHER]), now)).toMatch(/expected openLp/);
    expect(vetTx(iface, VAULT, act("protect", "closeLp", [1n, 0n, 0n, true, 0n, dl]), now)).toMatch(/expected protect/);
  });

  it("refuses unknown kinds, garbage calldata and malformed actions", () => {
    expect(vetTx(iface, VAULT, act("withdraw", "harvest", [1n, 0n, dl]), now)).toMatch(/unknown action kind/);
    const a = act("harvest", "harvest", [1n, 0n, dl]);
    a.built.tx.data = "0xdeadbeef";
    expect(vetTx(iface, VAULT, a, now)).toMatch(/does not decode|calldata is unknown/);
    expect(vetTx(iface, VAULT, { kind: "harvest" } as any, now)).toBe("malformed action");
    expect(vetTx(iface, VAULT, null as any, now)).toBe("malformed action");
  });

  it("refuses a transaction whose deadline is about to pass", () => {
    expect(vetTx(iface, VAULT, act("harvest", "harvest", [1n, 0n, now + 30], { deadline: now + 30 }), now)).toMatch(/deadline/);
    expect(vetTx(iface, VAULT, act("harvest", "harvest", [1n, 0n, dl], { deadline: undefined }), now)).toBeNull();
  });
});
