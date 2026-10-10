import { pushReady, tick } from "@/lib/push";
import { buildOurs, buildTip } from "@/lib/tips";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by the collector every few minutes with PUSH_TICK_SECRET.
export async function POST(request: Request) {
  const secret = process.env.PUSH_TICK_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!pushReady()) return Response.json({ error: "push not configured" }, { status: 503 });
  return Response.json(await tick(buildTip, Date.now(), buildOurs));
}
