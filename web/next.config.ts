import type { NextConfig } from "next";

// The commit this build came from, for the update toast: Netlify sets COMMIT_REF while
// building (not at run time), so it is baked in here.
const build = process.env.COMMIT_REF ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";

const nextConfig: NextConfig = {
  env: { VIG_BUILD: build },
  // A screen opened in the last 30 seconds comes back at once when you switch
  // tabs, without asking the server again. Prices don't move before kickoff, and
  // Codes fetches its own live data; app/resume.tsx refreshes after time away.
  experimental: { staleTimes: { dynamic: 30, static: 180 } },
  // Share images read their fonts from disk; make sure they ship with the route.
  outputFileTracingIncludes: { "/api/share/[code]": ["./assets/fonts/*.woff"] },
};

export default nextConfig;
