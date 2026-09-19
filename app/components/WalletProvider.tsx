"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_NAME, PRIVY_APP_ID, RPC_URL, WalletCtx, freshChainId, useSigner, useWallet, type Ctx, type Eip1193 } from "./walletShared";

/**
 * Wallet connection. The pattern throughout this app: API routes return UNSIGNED
 * calldata ({ to, data }), and this provider hands that to the user's wallet to sign.
 * The server never holds a key and never broadcasts on anyone's behalf.
 *
 * Two ways in, one interface (useWallet):
 *  - Privy, when NEXT_PUBLIC_PRIVY_APP_ID is set: email / Google / X sign-in with a wallet
 *    made for the user, or any external wallet (MetaMask, Rabby, WalletConnect…).
 *  - Plain EIP-1193 (window.ethereum) otherwise, with no extra service involved.
 * Either way the signer is an EIP-1193 provider, and every signature first asks that
 * provider which network it is on.
 */

export { useWallet };

const PrivyBridge = dynamic(() => import("./PrivyBridge"), { ssr: false });

// --- window.ethereum ---------------------------------------------------------------

/** Set when the user chose "Disconnect". The wallet still authorizes the site (EIP-1193
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

function eth(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

function InjectedWallet({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);

  // Reflect wallet-side changes. `linked` flips on a first connect, so the listeners
  // attach then too and not only after a reload.
  useEffect(() => {
    if (!(linked || wasOn()) || isOff()) return; // never connected here (or chose to disconnect): leave the wallet alone
    const e = eth();
    if (!e) return;
    const onAccounts = (accs: string[]) => { if (!isOff()) setAddress(accs[0] ?? null); };
    const onChain = (cid: string) => setChainId(parseInt(cid, 16));
    try { e.on?.("accountsChanged", onAccounts); e.on?.("chainChanged", onChain); } catch { /* odd injected provider; listeners are best-effort */ }
    if (typeof e.request === "function") {
      if (!isOff()) Promise.resolve().then(() => e.request({ method: "eth_accounts" })).then((accs: string[]) => { if (accs?.[0]) setAddress(accs[0]); }).catch(() => {});
      freshChainId(e, null).then((n) => { if (n !== null) setChainId(n); });
    }
    return () => { try { e.removeListener?.("accountsChanged", onAccounts); e.removeListener?.("chainChanged", onChain); } catch { /* ignore */ } };
  }, [linked]);

  const connect = useCallback(async () => {
    const e = eth();
    if (!e) { setError("No wallet found. Install MetaMask or another EIP-1193 wallet."); return; }
    setConnecting(true);
    setError(null);
    try {
      const accs: string[] = await e.request({ method: "eth_requestAccounts" });
      setOff(false); setOn(true); setLinked(true);
      setAddress(accs[0] ?? null);
      setChainId(await freshChainId(e, null));
    } catch (err: any) {
      setError(err?.code === 4001 ? null : (err?.message ?? "connection failed")); // 4001 = user rejected
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setOff(true); setOn(false); setLinked(false); setAddress(null); setError(null);
    const e = eth();
    if (typeof e?.request === "function") Promise.resolve().then(() => e.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })).catch(() => {});
  }, []);

  const switchChain = useCallback(async () => {
    const e = eth();
    if (!e) return;
    try {
      await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (err: any) {
      if (err?.code === 4902) { // chain unknown to the wallet; offer to add it
        try {
          await e.request({ method: "wallet_addEthereumChain", params: [{ chainId: CHAIN_ID_HEX, chainName: CHAIN_NAME, rpcUrls: [RPC_URL], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }] });
        } catch (err2: any) { if (err2?.code !== 4001) setError(err2?.message ?? "could not add the network"); }
      } else if (err?.code !== 4001) setError(err?.message ?? "could not switch network");
    }
    const n = await freshChainId(e, null);
    if (n !== null) setChainId(n);
  }, []);

  const getSigner = useCallback(async () => eth(), []);
  const { send, approve } = useSigner(address, getSigner, chainId, setChainId);
  return (
    <WalletCtx.Provider value={{ address, chainId, connecting, mode: "injected", wrongChain: address !== null && chainId !== null && chainId !== CHAIN_ID, error, connect, disconnect, switchChain, send, approve }}>
      {children}
    </WalletCtx.Provider>
  );
}

/** What pages see until the sign-in module has loaded: nobody connected, button busy. */
const LOADING: Ctx = {
  address: null, chainId: null, connecting: true, wrongChain: false, error: null, mode: "privy",
  connect: async () => {}, disconnect: () => {}, switchChain: async () => {},
  send: async () => { throw new Error("wallet not connected"); },
  approve: async () => { throw new Error("wallet not connected"); },
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<Ctx>(LOADING);
  if (!PRIVY_APP_ID) return <InjectedWallet>{children}</InjectedWallet>;
  return (
    <WalletCtx.Provider value={ctx}>
      {children}
      <PrivyBridge onCtx={setCtx} />
    </WalletCtx.Provider>
  );
}
