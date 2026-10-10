import { myProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

// The home-screen app opens here and goes to the page the account chose.
export async function GET(request: Request) {
  const { profile } = await myProfile().catch(() => ({ profile: null }));
  return Response.redirect(new URL(profile?.prefs?.home ?? "/", request.url), 302);
}
