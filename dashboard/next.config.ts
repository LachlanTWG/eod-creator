import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence the multi-lockfile warning — the parent repo has its own
  // package-lock.json for the Node service, unrelated to this Next app.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // /eod-entry renders inside a GoHighLevel Custom Menu Link iframe.
        // frame-ancestors * rather than listing GHL domains because agency
        // white-label domains are arbitrary; the page is token-gated and
        // cookie-free, so framing it gains an attacker nothing.
        source: "/eod-entry",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
