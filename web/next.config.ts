import path from 'node:path';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  async redirects() {
    return [
      { source: '/index.html', destination: '/', permanent: true },
      { source: '/impressum.html', destination: '/impressum', permanent: true },
      { source: '/datenschutz.html', destination: '/datenschutz', permanent: true },
      { source: '/ceo.html', destination: '/seo', permanent: true },
      { source: '/seo.html', destination: '/seo', permanent: true },
    ];
  },
  // The media service stays behind Nginx. Never proxy uploads or WS through Next.
  turbopack: { root: path.resolve(process.cwd(), "..") },
};

export default nextConfig;
