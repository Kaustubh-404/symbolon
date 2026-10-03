import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @symbolon/sdk ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@symbolon/sdk"],
  // No ESLint dependency in this app; type safety comes from `tsc` (strict) during `next build`.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  webpack(config) {
    // The SDK uses NodeNext-style `./x.js` specifiers for `./x.ts` sources.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return config;
  },
};

export default nextConfig;
