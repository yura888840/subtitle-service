import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  // The media service stays behind Nginx. Never proxy uploads or WS through Next.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
