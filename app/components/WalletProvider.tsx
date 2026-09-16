"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ethers } from "ethers";

/**
 * Minimal wallet connection over EIP-1193 (window.ethereum), no extra dependencies.
 *
 * The pattern throughout this app: API routes return UNSIGNED calldata ({ to, data }),
 * and this provider hands that to the user's wallet to sign. The server never holds a
 * key and never broadcasts on anyone's behalf.
 *
 * That last sentence is now true without qualification. It was written while
 * /api/execute still had a relayer mode that broadcast trades from a server-held key —
 * so the comment described the intent rather than the code. The relayer path was removed
 * in the security audit; see README section 3.
 */

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042);
const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);

type Ctx = {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  wrongChain: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  send: (tx: { to: string; data: string; value?: string }) => Promise<string>;
  approve: (token: string, spender: string, amount: bigint) => Promise<string | null>;
};

const WalletCtx = createContext<Ctx | null>(null);
export const useWallet = () => {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet must be used inside <WalletProvider>");
  return c;
};

/** Set when the user chose "Disconnect". The wallet still authorises the site (EIP-1193
 *  has no real disconnect), so without this flag a reload would silently reconnect. */
const OFF_KEY = "payoff.wallet.off";
/** Set once the user has connected here. Until then the page never touches
 *  window.ethereum: several extensions (Coinbase Wallet, Phantom, OKX, Rabby) treat the
 *  first eth_accounts call as "this site wants to connect" and pop a floating prompt. */
const ON_KEY = "payoff.wallet.on";
const wasOn = () => { try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; } };
const setOn = (v: boolean) => { try { v ? localStorage.setItem(ON_KEY, "1") : localStorage.removeItem(ON_KEY); } catch { /* private mode */ } };
const isOff = () => { try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; } };
const setOff = (v: boolean) => { try { v ? localStorage.setItem(OFF_KEY, "1") : localStorage.removeItem(OFF_KEY); } catch { /* private mode */ } };

function eth(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect wallet-side changes. Without these listeners the UI silently shows a stale
  // account after the user switches in MetaMask — and they'd sign from the wrong one.
  useEffect(() => {
    if (!wasOn() || isOff()) return; // never connected here (or chose to disconnect): leave the wallet alone
    const e = eth();
    if (!e) return;
    const onAccounts = (accs: string[]) => { if (!isOff()) setAddress(accs[0] ?? null); };
    const onChain = (cid: string) => setChainId(parseInt(cid, 16));
    try {
      e.on?.("accountsChanged", onAccounts);
      e.on?.("chainChanged", onChain);
    } catch { /* odd injected provider; listeners are best-effort */ }

    // restore an already-authorised session without prompting. Everything here is
    // wrapped so a non-conforming injected provider (a synchronous throw, a request
    // that is not a function) cannot take the root provider down.
    if (typeof e.request === "function") {
      if (!isOff()) Promise.resolve()
        .then(() => e.request({ method: "eth_accounts" }))
        .then((accs: string[]) => { if (accs?.[0]) setAddress(accs[0]); })
        .catch(() => {});
      Promise.resolve()
        .then(() => e.request({ method: "eth_chainId" }))
        .then((cid: string) => { const n = parseInt(cid, 16); if (Number.isFinite(n)) setChainId(n); })
        .catch(() => {});
    }

    return () => {
      try {
        e.removeListener?.("accountsChanged", onAccounts);
        e.removeListener?.("chainChanged", onChain);
      } catch { /* ignore */ }
    };
  }, []);

  /**
   * The chain id as the wallet reports it right now. `chainId` state is null when the
   * mount-time eth_chainId failed (some wallets answer late), so before refusing to
   * sign for "wrong network" ask again rather than trust a value we never got.
   */
  const currentChainId = useCallback(async (e: any): Promise<number | null> => {
    if (chainId !== null) return chainId;
    if (typeof e?.request !== "function") return null;
    try {
      const cid: string = await e.request({ method: "eth_chainId" });
      const n = parseInt(cid, 16);
      if (!Number.isFinite(n)) return null;
      setChainId(n);
      return n;
    } catch {
      return null;
    }
  }, [chainId]);

  const connect = useCallback(async () => {
    const e = eth();
    if (!e) {
      setError("No wallet found. Install MetaMask or another EIP-1193 wallet.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accs: string[] = await e.request({ method: "eth_requestAccounts" });
      setOff(false);
      setOn(true);
      setAddress(accs[0] ?? null);
      const cid: string = await e.request({ method: "eth_chainId" });
      setChainId(parseInt(cid, 16));
    } catch (err: any) {
      // 4001 = user rejected. Not an error worth shouting about.
      setError(err?.code === 4001 ? null : (err?.message ?? "connection failed"));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    // EIP-1193 has no real disconnect. Clear local state, remember the choice so a reload
    // does not reconnect, and ask the wallet to drop the permission where it supports
    // that (MetaMask does); elsewhere the wallet keeps the site authorised until the
    // user revokes it in the wallet itself.
    setOff(true);
    setOn(false);
    setAddress(null);
    setError(null);
    const e = eth();
    if (typeof e?.request === "function") {
      Promise.resolve()
        .then(() => e.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }))
        .catch(() => {});
    }
  }, []);

  const switchChain = useCallback(async () => {
    const e = eth();
    if (!e) return;
    try {
      await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (err: any) {
      // 4902 = chain unknown to the wallet; offer to add it.
      if (err?.code === 4902) {
        // Wallets reject an empty rpcUrls entry with an opaque error; say what is
        // missing instead. NEXT_PUBLIC_RPC_URL is a build-time value on Vercel.
        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
        if (!rpcUrl) {
          setError(`This deployment has no RPC configured for the wallet; add Arc (${CHAIN_ID}) to your wallet manually, then switch to it.`);
          return;
        }
        try {
        await e.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CHAIN_ID_HEX,
            chainName: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Arc",
            rpcUrls: [rpcUrl],
            nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
          }],
        });
        } catch (err2: any) {
          if (err2?.code !== 4001) setError(err2?.message ?? "could not add the network");
        }
      } else if (err?.code !== 4001) {
        setError(err?.message ?? "could not switch network");
      }
    }
  }, []);

  /** Sign and broadcast calldata returned by an API route. */
  const send = useCallback(async (tx: { to: string; data: string; value?: string }) => {
    const e = eth();
    if (!e || !address) throw new Error("wallet not connected");
    const cid = await currentChainId(e);
    if (cid !== CHAIN_ID) throw new Error(`wrong network — switch to chain ${CHAIN_ID} first`);
    return await e.request({
      method: "eth_sendTransaction",
      params: [{ from: address, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }],
    });
  }, [address, currentChainId]);

  /**
   * ERC20 approve, skipped when the allowance already covers `amount`.
   * Staking and LP entry both move tokens the contract does not yet control, so an
   * approve has to land before the real call — this is the step people forget.
   */
  const approve = useCallback(async (token: string, spender: string, amount: bigint) => {
    const e = eth();
    if (!e || !address) throw new Error("wallet not connected");
    const cid = await currentChainId(e);
    if (cid !== CHAIN_ID) throw new Error(`wrong network — switch to chain ${CHAIN_ID} first`);
    const provider = new ethers.BrowserProvider(e);
    const erc20 = new ethers.Contract(token, [
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
    ], provider);

    const current: bigint = await erc20.allowance(address, spender);
    if (current >= amount) return null;

    const iface = new ethers.Interface(["function approve(address,uint256)"]);
    return await send({ to: token, data: iface.encodeFunctionData("approve", [spender, amount]) });
  }, [address, send, currentChainId]);

  return (
    <WalletCtx.Provider value={{
      address, chainId, connecting,
      wrongChain: address !== null && chainId !== null && chainId !== CHAIN_ID,
      error, connect, disconnect, switchChain, send, approve,
    }}>
      {children}
    </WalletCtx.Provider>
  );
}
