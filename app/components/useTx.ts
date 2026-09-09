"use client";

import { useCallback, useState } from "react";
import { useWallet } from "./WalletProvider";
import { walletErrorMessage } from "@/lib/wallet-errors";

/**
 * Send an action the API built: POST for calldata, sign any approvals first, then the
 * transaction. The page never sees a key; the wallet does the signing.
 */

export type Built = {
  tx: { to: string; data: string; value: string; description: string };
  approvals: Array<{ token: string; spender: string; amount: string; symbol: string }>;
  approveTxs?: Array<{ to: string; data: string; value: string }>;
  notes?: string[];
  deadline?: number;
  error?: string;
};

export type TxState = { busy: boolean; step: string | null; hash: string | null; error: string | null; built: Built | null };

export function useTx() {
  const w = useWallet();
  const [state, setState] = useState<TxState>({ busy: false, step: null, hash: null, error: null, built: null });

  const reset = useCallback(() => setState({ busy: false, step: null, hash: null, error: null, built: null }), []);

  /** Ask the API for calldata without sending it (preview). */
  const preview = useCallback(async (url: string, body: unknown): Promise<Built> => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as Built;
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }, []);

  const run = useCallback(async (url: string, body: unknown): Promise<string | null> => {
    if (!w.address) { setState((s) => ({ ...s, error: "Connect a wallet first" })); return null; }
    if (w.wrongChain) { setState((s) => ({ ...s, error: "Switch to Robinhood Chain first" })); return null; }
    setState({ busy: true, step: "Building transaction…", hash: null, error: null, built: null });
    try {
      const built = await preview(url, body);
      setState((s) => ({ ...s, built }));
      for (const a of built.approvals) {
        setState((s) => ({ ...s, step: `Approve ${a.symbol}…` }));
        await w.approve(a.token, a.spender, BigInt(a.amount));
      }
      setState((s) => ({ ...s, step: `Sign: ${built.tx.description}` }));
      const hash = await w.send({ to: built.tx.to, data: built.tx.data, value: built.tx.value });
      setState({ busy: false, step: null, hash, error: null, built });
      return hash;
    } catch (err) {
      setState((s) => ({ ...s, busy: false, step: null, error: walletErrorMessage(err) }));
      return null;
    }
  }, [w, preview]);

  return { ...state, run, preview, reset, address: w.address, wrongChain: w.wrongChain };
}
