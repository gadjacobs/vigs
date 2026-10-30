import { lastTick, lastTickError } from "@/lib/push";
import { setJson, storeReady } from "@/lib/store";
import { runTickOnce } from "@/lib/ticker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const authorised = (request: Request) => {
  const secret = process.env.PUSH_TICK_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
};

// The fallback way in: the collector calls this with PUSH_TICK_SECRET when it
// can't run the pass itself (no REDIS_URL secret in GitHub). Each call uses Vercel CPU.
export async function POST(request: Request) {
  if (!authorised(request)) {
    // Note that a call arrived with the wrong secret, for the Alerts setup check.
    if (process.env.PUSH_TICK_SECRET && storeReady()) await setJson("tickRefused", Date.now()).catch(() => undefined);
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const out = await runTickOnce();
  return Response.json(out, { status: out.error === "push not configured" ? 503 : 200 });
}

/** For the collector's log: when the tick last ran, and its last error. */
export async function GET(request: Request) {
  if (!authorised(request)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const [at, err] = await Promise.all([lastTick().catch(() => null), lastTickError().catch(() => null)]);
  return Response.json({ lastTick: at, lastError: err });
}
