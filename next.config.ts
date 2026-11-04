import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only libs used by route handlers; load them with native require instead of bundling.
  serverExternalPackages: ["nodemailer", "ws", "@neondatabase/serverless", "html-to-text"],
};

export default nextConfig;
