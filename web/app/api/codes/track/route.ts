import { trackCodes } from "@/app/push-actions";

// Codes reads its codes through this route rather than a server action: the
// browser sends server actions one at a time, so sync, tracking and live
// scores used to queue behind each other. Plain requests run side by side.
// Signed-in only (proxy.ts).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { codes?: unknown } | null;
  const codes = Array.isArray(body?.codes) ? body.codes.filter((c): c is string => typeof c === "string" && /^[A-Z0-9]{4,12}$/.test(c)) : [];
  return Response.json(await trackCodes(codes), { headers: { "Cache-Control": "no-store" } });
}
