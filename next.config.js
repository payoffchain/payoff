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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
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
  async redirects() {
    return [
      { source: "/deploy", destination: "/borrow", permanent: true },
      // the old preview host forwards to the real domain (API paths included, since the
      // runner and any old bookmark should land on one canonical origin)
      // (payoff-pi.vercel.app -> payoffchain.tech is switched on once DNS resolves; see below)
      { source: "/:path*", has: [{ type: "host", value: "www.payoffchain.tech" }], destination: "https://payoffchain.tech/:path*", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
