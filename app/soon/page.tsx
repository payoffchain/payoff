import type { Metadata } from "next";
import { APP, TWITTER, TWITTER_HANDLE } from "../components/brand";
import FeedbackForm from "../components/FeedbackForm";

export const metadata: Metadata = { title: "Paused", robots: { index: false, follow: false } };

/**
 * The holding page shown while the site is locked (SITE_LOCKED=1). SITE_LOCKED_NOTE
 * replaces the main message; the form under it collects messages for the team.
 */
const NOTE = process.env.SITE_LOCKED_NOTE
  ?? "We were not able to recover our original X account, so the site is paused while we decide how to keep in touch with you.";

export default function Soon() {
  return (
    <main className="soon-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mark.png" alt={APP} width={96} height={96} />
      <h1>{APP}</h1>
      <p>paused</p>
      <span className="soon-note">{NOTE}</span>
      <span className="soon-note"><b>Update:</b> thank you for every message. Our new official X account is live, follow it for news. A Discord for the community comes next.</span>
      {TWITTER && <a href={TWITTER} target="_blank" rel="noopener noreferrer">𝕏 Follow {TWITTER_HANDLE}</a>}
      <FeedbackForm />
      <span className="soon-note small">Contracts on chain are not affected. Vault owners keep full control of their vaults through the block explorer at any time.</span>
    </main>
  );
}
