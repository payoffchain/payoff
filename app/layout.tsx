import type { Metadata } from "next";
import "./globals.css";
import "./motion.css";
import "./theme.css";
import "./demo.css";
import "./tactile.css";
import "./brutal.css";
import "./navy.css";
import { WalletProvider } from "./components/WalletProvider";
import { APP, SITE } from "./components/brand";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: `${APP} — self-repaying loans on Robinhood Chain`, template: `%s — ${APP}` },
  description:
    "Borrow USDG against tokenized stocks on Morpho, and let the loan pay itself: the USDG earns Uniswap V3 trading fees that go straight onto your debt. Non-custodial: only you can take money out.",
  openGraph: {
    type: "website",
    siteName: APP,
    title: `${APP} — Your loan pays itself down`,
    description: "Self-repaying loans on Robinhood Chain: borrow USDG against tokenized stocks; trading fees pay the debt down.",
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
        <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Bricolage+Grotesque:wght@700;800&family=Pixelify+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#020818" />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
