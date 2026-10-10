/** This deployment, for the update toast. */
export const BUILD = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "dev";
