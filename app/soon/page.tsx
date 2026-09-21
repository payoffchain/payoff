import type { Metadata } from "next";
import { APP, TWITTER, TWITTER_HANDLE } from "../components/brand";

export const metadata: Metadata = { title: "Paused", robots: { index: false, follow: false } };

/**
 * The holding page shown while the site is locked (SITE_LOCKED=1). SITE_LOCKED_NOTE
 * replaces the message; without it the page says why the site is paused right now.
 */
const NOTE = process.env.SITE_LOCKED_NOTE
  ?? "The site is paused while our original X account is being restored. We will open it again as soon as the account is back.";

export default function Soon() {
  return (
    <main className="soon-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mark.png" alt={APP} width={96} height={96} />
      <h1>{APP}</h1>
      <p>back soon</p>
      <span className="soon-note">{NOTE}</span>
      <span className="soon-note small">Contracts on chain are not affected. Vault owners keep full control of their vaults through the block explorer at any time.</span>
      {TWITTER && <a href={TWITTER} target="_blank" rel="noopener noreferrer">𝕏 {TWITTER_HANDLE}</a>}
    </main>
  );
}
