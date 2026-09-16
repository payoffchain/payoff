"use client";

import { useCallback, useRef, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "./WalletProvider";
import { walletErrorMessage } from "@/lib/wallet-errors";

/**
 * Send an action the API built: POST for calldata, sign any approvals first and WAIT
 * for each to be mined, then the transaction, then wait for its receipt. The page never
 * sees a key; the wallet does the signing.
 *
 * Waiting on the approval matters: wallets estimate gas for the next transaction
 * before the approval is mined, see `transferFrom` revert, and either warn ("likely
 * to fail") or refuse. Waiting on the receipt is what lets a page show "reverted"
 * instead of a green "sent" over unchanged numbers.
 */

export type Built = {
  tx: { to: string; data: string; value: string; description: string };
  approvals: Array<{ token: string; spender: string; amount: string; symbol: string }>;
  notes?: string[];
  deadline?: number;
  error?: string;
};

export type TxState = {
  busy: boolean;
  step: string | null;
  hash: string | null;
  /** null until the receipt arrives; then "confirmed" or "reverted" */
  outcome: "confirmed" | "reverted" | null;
  error: string | null;
  built: Built | null;
};

const IDLE: TxState = { busy: false, step: null, hash: null, outcome: null, error: null, built: null };

export function useTx() {
  const w = useWallet();
  const [state, setState] = useState<TxState>(IDLE);
  const inFlight = useRef(false);

  const reset = useCallback(() => setState(IDLE), []);

  /** Ask the API for calldata without sending it (preview). */
  const preview = useCallback(async (url: string, body: unknown): Promise<Built> => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as Built;
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }, []);

  /**
   * Build, approve, sign, wait. Resolves with the hash once the receipt is in and the
   * transaction succeeded; null when the user rejected, the API refused, or it reverted.
   * A second call while one is in flight is ignored: no double-submits from a fast click.
   */
  const run = useCallback(async (url: string, body: unknown, opts: { onHash?: (hash: string) => void } = {}): Promise<string | null> => {
    if (inFlight.current) return null;
    if (!w.address) { setState((s) => ({ ...s, error: "Connect a wallet first" })); return null; }
    if (w.wrongChain) { setState((s) => ({ ...s, error: "Switch to Arc first" })); return null; }
    inFlight.current = true;
    setState({ ...IDLE, busy: true, step: "Building transaction…" });
    try {
      const built = await preview(url, body);
      setState((s) => ({ ...s, built }));
      if (built.deadline && built.deadline < Math.floor(Date.now() / 1000) + 120) throw new Error("This transaction's deadline is about to pass; try again.");
      const eth = (window as any).ethereum;
      const provider = eth ? new ethers.BrowserProvider(eth) : null;
      for (const a of built.approvals) {
        setState((s) => ({ ...s, step: `Approve ${a.symbol}…` }));
        const ah = await w.approve(a.token, a.spender, BigInt(a.amount));
        if (ah && provider) {
          setState((s) => ({ ...s, step: `Waiting for the ${a.symbol} approval to confirm…` }));
          const rc = await provider.waitForTransaction(ah, 1, 180_000);
          if (rc && rc.status !== 1) throw new Error(`The ${a.symbol} approval reverted.`);
        }
      }
      setState((s) => ({ ...s, step: `Sign: ${built.tx.description}` }));
      const hash = await w.send({ to: built.tx.to, data: built.tx.data, value: ethers.toQuantity(BigInt(built.tx.value || "0")) });
      opts.onHash?.(hash);
      setState((s) => ({ ...s, hash, step: "Waiting for confirmation…" }));
      let outcome: TxState["outcome"] = null;
      if (provider) {
        try {
          const rc = await provider.waitForTransaction(hash, 1, 180_000);
          outcome = rc ? (rc.status === 1 ? "confirmed" : "reverted") : null;
        } catch { outcome = null; /* still pending; the page can refresh later */ }
      }
      setState({ ...IDLE, hash, outcome, built, error: outcome === "reverted" ? "The transaction was mined but reverted. Nothing changed." : null });
      return outcome === "reverted" ? null : hash;
    } catch (err) {
      setState((s) => ({ ...s, busy: false, step: null, error: walletErrorMessage(err) }));
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [w, preview]);

  return { ...state, run, preview, reset, address: w.address, wrongChain: w.wrongChain };
}
