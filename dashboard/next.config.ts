import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence the multi-lockfile warning — the parent repo has its own
  // package-lock.json for the Node service, unrelated to this Next app.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
