/** @type {import('next').NextConfig} */

// A dApp that asks users to sign wallet transactions must not be embeddable in someone
// else's page: a framed copy of /stake with a transparent overlay is how a click on
// "Stake" becomes a signature on something else. The CSP below allows exactly what the
// app loads (self, the Google Fonts stylesheet and font files, and any RPC the browser
// wallet reaches via NEXT_PUBLIC_RPC_URL) and nothing more.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // Next.js injects inline scripts for hydration; 'unsafe-inline' for styles covers
      // the style props the pages use. Tighten with nonces if you move to strict CSP.
      // challenges.cloudflare.com: the bot check on Privy's sign-in
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // blob: and the WalletConnect explorer: wallet icons in the sign-in dialog
      "img-src 'self' data: blob: https://explorer-api.walletconnect.com",
      // Privy's sign-in and the wallet it makes run in an iframe from auth.privy.io
      "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
      "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
      "worker-src 'self'",
      // The wallet provider talks to the chain through the wallet, but ethers'
      // BrowserProvider and any NEXT_PUBLIC_RPC_URL reads go straight from the page.
      "connect-src 'self' https: wss:",
    ].join("; "),
  },
];

const nextConfig = {
  // NEXT_DIST_DIR lets a dev server build somewhere other than .next, so a production
  // build run in the same checkout cannot clobber it mid-session.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(config) {
    // optional peers of @privy-io/react-auth that this app never loads
    config.resolve.alias["@farcaster/mini-app-solana"] = false;
    return config;
  },
  async redirects() {
    return [
      { source: "/deploy", destination: "/borrow", permanent: true },
      // the old preview host forwards to the real domain (API paths included, since the
      // runner and any old bookmark should land on one canonical origin)
      { source: "/:path*", has: [{ type: "host", value: "payoff-pi.vercel.app" }], destination: "https://payoffchain.tech/:path*", permanent: true },
      { source: "/:path*", has: [{ type: "host", value: "www.payoffchain.tech" }], destination: "https://payoffchain.tech/:path*", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Logos are fetched from other hosts and re-served from this origin: opened on
      // their own they must be inert, whatever the bytes turn out to be.
      { source: "/api/logo/:symbol*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; sandbox" }] },
    ];
  },
};

module.exports = nextConfig;
