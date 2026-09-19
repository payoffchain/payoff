"use client";

import { createContext, useCallback, useContext } from "react";
import { ethers } from "ethers";

/** Pieces both wallet modes share: the context, the chain constants, and send/approve. */

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
export const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);
export const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Robinhood Chain";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://robinhoodchain.blockscout.com";
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export type Ctx = {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  wrongChain: boolean;
  error: string | null;
  /** "privy" signs in with email, socials or a wallet; "injected" is window.ethereum only */
  mode: "privy" | "injected";
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  send: (tx: { to: string; data: string; value?: string }) => Promise<string>;
  approve: (token: string, spender: string, amount: bigint) => Promise<string | null>;
};

export const WalletCtx = createContext<Ctx | null>(null);
export const useWallet = () => {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet must be used inside <WalletProvider>");
  return c;
};

export type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<any>; on?: (e: string, f: (...a: any[]) => void) => void; removeListener?: (e: string, f: (...a: any[]) => void) => void };

/**
 * The chain id as the signer reports it right now. Always asked fresh before signing:
 * state can be stale (a missed chainChanged event, a wallet that answers late), and a
 * transaction sent on the wrong network is not something to risk on a cached value.
 */
export async function freshChainId(e: Eip1193 | null, fallback: number | null): Promise<number | null> {
  if (typeof e?.request !== "function") return fallback;
  try {
    const n = parseInt(await e.request({ method: "eth_chainId" }), 16);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** send + approve over whatever EIP-1193 signer the mode provides. */
export function useSigner(address: string | null, getSigner: () => Promise<Eip1193 | null>, chainId: number | null, setChainId: (n: number) => void, ensureChain?: () => Promise<void>) {
  const send = useCallback(async (tx: { to: string; data: string; value?: string }) => {
    const e = await getSigner();
    if (!e || !address) throw new Error("wallet not connected");
    let cid = await freshChainId(e, chainId);
    if (cid !== CHAIN_ID && ensureChain) {
      // a wallet made at sign-in can simply be told which chain to use
      try { await ensureChain(); cid = await freshChainId(e, chainId); } catch { /* fall through to the error below */ }
    }
    if (cid !== null) setChainId(cid);
    if (cid !== CHAIN_ID) throw new Error(`wrong network — switch to chain ${CHAIN_ID} first`);
    return await e.request({ method: "eth_sendTransaction", params: [{ from: address, to: tx.to, data: tx.data, value: tx.value ?? "0x0" }] }) as string;
  }, [address, getSigner, chainId, setChainId, ensureChain]);

  /**
   * ERC20 approve, skipped when the allowance already covers `amount`. Deposits move
   * tokens the vault does not yet control, so an approve has to land before the real call.
   */
  const approve = useCallback(async (token: string, spender: string, amount: bigint) => {
    const e = await getSigner();
    if (!e || !address) throw new Error("wallet not connected");
    const provider = new ethers.BrowserProvider(e as any);
    const erc20 = new ethers.Contract(token, ["function allowance(address,address) view returns (uint256)"], provider);
    const cid = await freshChainId(e, chainId);
    if (cid === CHAIN_ID) {
      const current: bigint = await erc20.allowance(address, spender);
      if (current >= amount) return null;
    }
    const iface = new ethers.Interface(["function approve(address,uint256)"]);
    return await send({ to: token, data: iface.encodeFunctionData("approve", [spender, amount]) });
  }, [address, getSigner, chainId, send]);

  return { send, approve };
}

