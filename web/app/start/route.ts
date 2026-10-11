import { cookies } from "next/headers";
import { myProfile, needsTour } from "@/lib/profile";

export const dynamic = "force-dynamic";

// The home-screen app opens here and goes to the page the account chose.
export async function GET(request: Request) {
  const { user, profile } = await myProfile().catch(() => ({ user: null, profile: null }));
  if (needsTour(user, profile, (await cookies()).get("vig_onb")?.value))
    return Response.redirect(new URL("/onboarding", request.url), 302);
  return Response.redirect(new URL(profile?.prefs?.home ?? "/", request.url), 302);
}
