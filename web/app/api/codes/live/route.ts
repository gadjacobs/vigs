import { liveCodes } from "@/app/live-actions";
import type { LegRef } from "@/lib/live";

// Live scores and chances for open codes, as a plain request so it never waits
// behind another call (see ../track/route.ts). Signed-in only (proxy.ts).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { legs?: unknown } | null;
  const legs = Array.isArray(body?.legs) ? (body.legs as LegRef[]).slice(0, 400) : [];
  return Response.json(await liveCodes(legs), { headers: { "Cache-Control": "no-store" } });
}
