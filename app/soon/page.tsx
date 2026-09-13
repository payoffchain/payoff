import type { Metadata } from "next";
import { APP, TWITTER, TWITTER_HANDLE } from "../components/brand";

export const metadata: Metadata = { title: "Soon", robots: { index: false, follow: false } };

/** The holding page shown while the site is locked (SITE_LOCKED=1). Says nothing about the product. */
export default function Soon() {
  return (
    <main className="soon">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mark.png" alt={APP} width={96} height={96} />
      <h1>{APP}</h1>
      <p>soon</p>
      {TWITTER && <a href={TWITTER} target="_blank" rel="noopener noreferrer">𝕏 {TWITTER_HANDLE}</a>}
    </main>
  );
}
