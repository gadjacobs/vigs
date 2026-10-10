import { cookies } from "next/headers";
import { googleEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Starts Google sign-in. The 18+ box on the sign-in form must be ticked.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!googleEnabled()) return Response.redirect(new URL("/login?err=google", url), 302);
  if (url.searchParams.get("adult") !== "on") return Response.redirect(new URL("/login?err=age", url), 302);
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  (await cookies()).set("vig_oauth", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: `${url.origin}/api/auth/google/callback`,
    response_type: "code", scope: "openid email profile", state, prompt: "select_account",
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
}
