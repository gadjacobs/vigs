import type { NextConfig } from "next";

// The commit this build came from, for the update toast: Netlify sets COMMIT_REF while
// building (not at run time), so it is baked in here.
const build = process.env.COMMIT_REF ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";

const nextConfig: NextConfig = {
  env: { VIG_BUILD: build },
  // Share images read their fonts from disk; make sure they ship with the route.
  outputFileTracingIncludes: { "/api/share/[code]": ["./assets/fonts/*.woff"] },
};

export default nextConfig;
