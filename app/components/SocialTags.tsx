"use client";

import { useState } from "react";
import { TWITTER, TWITTER_HANDLE, TOKEN_CA } from "./brand";

/**
 * The X handle and the token address as two desk stickers: slightly tilted, mono,
 * one of them a dashed "soon" stamp until the token exists. Used in the hero and in
 * the closing slab, not in the nav.
 */
export default function SocialTags({ style }: { style?: React.CSSProperties }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!TOKEN_CA) return;
    try { await navigator.clipboard.writeText(TOKEN_CA); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="stickers" style={style}>
      {TWITTER && (
        <a className="sticker x" href={TWITTER} target="_blank" rel="noopener noreferrer">
          <span className="lbl">FOLLOW</span><span className="val">𝕏 {TWITTER_HANDLE}</span>
        </a>
      )}
      {TOKEN_CA ? (
        <button className="sticker ca" onClick={copy} title={TOKEN_CA}>
          <span className="lbl">CA</span><span className="val">{copied ? "copied" : TOKEN_CA.slice(0, 8) + "…" + TOKEN_CA.slice(-6)}</span><span className="cp">⧉</span>
        </button>
      ) : (
        <span className="sticker ca soon" title="Token contract address: not launched yet">
          <span className="lbl">CA</span><span className="val">SOON</span>
        </span>
      )}
    </div>
  );
}
