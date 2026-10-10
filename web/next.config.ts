import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Share images read their fonts from disk; make sure they ship with the route.
  outputFileTracingIncludes: { "/api/share/[code]": ["./assets/fonts/*.woff"] },
};

export default nextConfig;
