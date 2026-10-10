import { cookies } from "next/headers";
import { googleAccountFor, googleEnabled, googleSession } from "@/lib/auth";
import { updateProfile } from "@/lib/profile";
import { storeReady } from "@/lib/store";

export const dynamic = "force-dynamic";

// Google sends the user back here with a one-time code: swap it for their
// verified email, map that to an allowed account and start a session.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (err: string) => Response.redirect(new URL(`/login?err=${err}`, url), 302);
  const jar = await cookies();
  const state = jar.get("vig_oauth")?.value;
  jar.delete("vig_oauth");
  if (!googleEnabled() || !state || url.searchParams.get("state") !== state || !url.searchParams.get("code")) return fail("google");
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code")!, client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${url.origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  }).then((r) => r.json() as Promise<{ access_token?: string }>).catch(() => ({ access_token: undefined }));
  if (!tok.access_token) return fail("google");
  const who = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } })
    .then((r) => r.json() as Promise<{ email?: string; email_verified?: boolean; name?: string; picture?: string }>)
    .catch(() => ({}) as { email?: string; email_verified?: boolean; name?: string; picture?: string });
  if (!who.email || !who.email_verified) return fail("google");
  const name = googleAccountFor(who.email);
  if (!name) return fail("notallowed");
  jar.set("vig_auth", await googleSession(name), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  if (storeReady())
    await updateProfile(name, (p) => ({ ...p, who: { email: who.email!, name: who.name ?? "", picture: who.picture ?? "", via: "google" } }))
      .catch(() => undefined);
  return Response.redirect(new URL("/", url), 302);
}
