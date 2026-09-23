import type { Metadata } from "next";
import { APP } from "../components/brand";
import FeedbackForm from "../components/FeedbackForm";

export const metadata: Metadata = { title: "Paused", robots: { index: false, follow: false } };

/**
 * The holding page shown while the site is locked (SITE_LOCKED=1). SITE_LOCKED_NOTE
 * replaces the main message; the form under it collects messages for the team.
 */
const NOTE = process.env.SITE_LOCKED_NOTE
  ?? "We have created five X accounts for PAYOFF and every one of them was suspended, so we are stepping away from X and pausing the site for now.";

export default function Soon() {
  return (
    <main className="soon-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mark.png" alt={APP} width={96} height={96} />
      <h1>{APP}</h1>
      <p>paused</p>
      <span className="soon-note">{NOTE}</span>
      <span className="soon-note"><b>Update:</b> thank you for every message you left here. We will share a new way to reach us on this page once it is ready. Until then, leave a message below.</span>
      <FeedbackForm />
      <span className="soon-note small">Contracts on chain are not affected. Vault owners keep full control of their vaults through the block explorer at any time.</span>
    </main>
  );
}
