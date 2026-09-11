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
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/deploy", destination: "/borrow", permanent: true }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
