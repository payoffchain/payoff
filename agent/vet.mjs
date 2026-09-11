/**
 * The only gate between the site's answer and the operator key. Pure, so it can be
 * tested without a chain: given the vault this runner operates and an action from the
 * plan, return a reason the transaction must NOT be signed, or null when it may.
 */
import { ethers } from "ethers";

/** action kind -> the vault function it must decode to. Nothing else is ever signed. */
export const ALLOWED = { protect: "protect", refinance: "refinance", harvest: "harvest", close: "closeLp", open: "openLp" };

export function vetTx(vaultIface, vault, action, nowSeconds = Math.floor(Date.now() / 1000)) {
  const tx = action?.built?.tx;
  if (!tx || typeof tx.to !== "string" || typeof tx.data !== "string") return "malformed action";
  if (!ethers.isAddress(tx.to) || tx.to.toLowerCase() !== vault.toLowerCase()) return `tx.to ${tx.to} is not the vault`;
  let value = 0n;
  try { value = BigInt(tx.value ?? "0"); } catch { return "tx.value is not a number"; }
  if (value !== 0n) return `tx.value must be 0, got ${value}`;
  const want = ALLOWED[action.kind];
  if (!want) return `unknown action kind ${action.kind}`;
  let parsed;
  try { parsed = vaultIface.parseTransaction({ data: tx.data }); } catch { return "calldata does not decode against the vault ABI"; }
  if (!parsed || parsed.name !== want) return `calldata is ${parsed?.name ?? "unknown"}, expected ${want} for kind ${action.kind}`;
  const dl = action.built.deadline;
  if (typeof dl === "number" && dl < nowSeconds + 60) return "deadline is within a minute; rebuild next tick";
  return null;
}
