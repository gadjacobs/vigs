import { NextResponse, type NextRequest } from "next/server";

// Personal tool: everything sits behind APP_PASSWORD when it is set.
export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vig:${password}`));
  const want = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  if (request.cookies.get("vig_auth")?.value === want) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // The service worker, manifest and icons load without cookies; the tick checks its own secret.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon-|apple-touch-icon|api/push/tick).*)"],
};
