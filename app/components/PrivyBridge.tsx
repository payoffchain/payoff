"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { defineChain } from "viem";
import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, PRIVY_APP_ID, RPC_URL, freshChainId, useSigner, type Ctx, type Eip1193 } from "./walletShared";

/**
 * Privy sign-in, kept in its own chunk: it is by far the heaviest thing on the site, so
 * pages render first and this loads behind them. It renders nothing of its own; it
 * reports the wallet state up to WalletProvider, which owns the context.
 */

const appChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER_URL } },
});

function Bridge({ onCtx }: { onCtx: (c: Ctx) => void }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const wallet = authenticated ? wallets[0] ?? null : null;
  const address = wallet?.address ?? null;
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Privy reports the chain as a CAIP-2 string ("eip155:4663")
  useEffect(() => {
    const n = wallet?.chainId ? Number(String(wallet.chainId).split(":").pop()) : NaN;
    setChainId(Number.isFinite(n) ? n : null);
  }, [wallet?.chainId, wallet?.address]);

  // Privy hands back new objects and functions on every render. Anything built on them
  // would change every render too, and since the context is reported upward from an
  // effect, that turns into an endless update loop. Refs keep the callbacks stable; only
  // the address, the chain and the ready flag ever change what pages see.
  const live = useRef({ wallet, login, logout });
  live.current = { wallet, login, logout };

  const getSigner = useCallback(async () => { const w = live.current.wallet; return w ? ((await w.getEthereumProvider()) as unknown as Eip1193) : null; }, []);
  const ensureChain = useCallback(async () => { const w = live.current.wallet; if (w) await w.switchChain(CHAIN_ID); }, []);

  const connect = useCallback(async () => { setError(null); live.current.login(); }, []);
  const disconnect = useCallback(() => { setError(null); void live.current.logout(); }, []);
  const switchChain = useCallback(async () => {
    try { await ensureChain(); setChainId(await freshChainId(await getSigner(), chainId)); }
    catch (err: any) { if (err?.code !== 4001) setError(err?.message ?? "could not switch network"); }
  }, [ensureChain, getSigner, chainId]);

  const { send, approve } = useSigner(address, getSigner, chainId, setChainId, ensureChain);
  const value = useMemo<Ctx>(() => ({
    address, chainId, connecting: !ready, mode: "privy",
    wrongChain: address !== null && chainId !== null && chainId !== CHAIN_ID,
    error, connect, disconnect, switchChain, send, approve,
  }), [address, chainId, ready, error, connect, disconnect, switchChain, send, approve]);
  useEffect(() => { onCtx(value); }, [value, onCtx]);
  return null;
}

export default function PrivyBridge({ onCtx }: { onCtx: (c: Ctx) => void }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        defaultChain: appChain,
        supportedChains: [appChain],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        appearance: { theme: "light", accentColor: "#5b78f2", logo: "/mark.png", walletChainType: "ethereum-only" },
      }}
    >
      <Bridge onCtx={onCtx} />
    </PrivyProvider>
  );
}
