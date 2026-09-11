import type { Metadata } from "next";
import "./globals.css";
import "./motion.css";
import "./theme.css";
import "./demo.css";
import "./tactile.css";
import { WalletProvider } from "./components/WalletProvider";
import { APP, SITE } from "./components/brand";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: `${APP} — self-repaying loans on Robinhood Chain`, template: `%s — ${APP}` },
  description:
    "Borrow USDG against tokenized stocks on Morpho. An agent you scope puts the loan to work in Uniswap V3, pays the debt down with the fees, hops to cheaper markets, and steps in before liquidation. Non-custodial: the vault is yours, the operator key cannot withdraw.",
  openGraph: {
    type: "website",
    siteName: APP,
    title: `${APP} — Your loan pays itself down`,
    description: "Self-repaying loans on Robinhood Chain: Morpho debt, Uniswap V3 fees, an agent that cannot withdraw.",
    url: SITE,
  },
  twitter: { card: "summary_large_image", title: `${APP} — Your loan pays itself down`, description: "Self-repaying loans on Robinhood Chain." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#0c0b0a" />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
