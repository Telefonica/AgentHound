import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output is for the Docker image; `next start` (used by the visual tests) refuses it.
  output: process.env.NEXT_DISABLE_STANDALONE ? undefined : "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/threat-models/:path*",
        destination: "/tests/:path*",
        permanent: true,
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
