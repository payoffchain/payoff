/**
 * One place that turns an ethers / EIP-1193 wallet error into a sentence a person can
 * act on. The raw object is still logged, so nothing is lost — it just is not pasted
 * into the page as a wall of JSON-RPC internals.
 */
export function walletErrorMessage(err: unknown, fallback = "Transaction failed. Nothing was signed."): string {
  console.error("[wallet]", err);
  const e = (err ?? {}) as { code?: unknown; reason?: unknown; shortMessage?: unknown; message?: unknown; info?: { error?: { code?: unknown; message?: unknown } } };
  const code = e.code ?? e.info?.error?.code;
  const text = String(e.shortMessage ?? e.message ?? e.info?.error?.message ?? "");

  if (code === 4001 || code === "ACTION_REJECTED" || /user rejected|user denied/i.test(text)) return "Rejected in wallet.";
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(text)) return "Not enough ETH for gas.";
  if (code === "CALL_EXCEPTION") {
    const why = typeof e.reason === "string" && e.reason ? e.reason : typeof e.shortMessage === "string" && e.shortMessage ? e.shortMessage : "";
    return why ? `Reverted: ${why}` : "The contract reverted. Nothing moved.";
  }
  if (code === "NETWORK_ERROR" || code === "TIMEOUT") return "The RPC did not answer. Try again.";
  if (code === "UNSUPPORTED_OPERATION" || code === 4100 || code === 4200) return "Your wallet does not support this operation.";
  // Short, non-technical errors thrown by our own code (API messages, "wrong network") are kept.
  if (text && text.length <= 120 && !/\{|0x[0-9a-f]{20,}/i.test(text)) return text;
  return fallback;
}
