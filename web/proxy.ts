import { NextResponse, type NextRequest } from "next/server";
import { verify } from "./lib/auth";

// Personal tool: everything sits behind an account when ACCOUNTS or APP_PASSWORD is set.
export async function proxy(request: NextRequest) {
  if (await verify(request.cookies.get("vig_auth")?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // The service worker, manifest and icons load without cookies; the tick checks its own secret.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon-|badge-|apple-touch-icon|api/push/tick|api/codes/log|api/auth/google).*)"],
};
