import { lastTick, lastTickError, pushReady, tick, type TickError } from "@/lib/push";
import { currentSlates } from "@/lib/kitchen";
import { claim, setJson, storeReady } from "@/lib/store";
import { tidyStore } from "@/lib/tidy";
import { buildOurs, buildTip } from "@/lib/tips";
import { runWatches } from "@/lib/watches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const authorised = (request: Request) => {
  const secret = process.env.PUSH_TICK_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

// Called by the collector every few minutes with PUSH_TICK_SECRET.
export async function POST(request: Request) {
  if (!authorised(request)) {
    // Note that a call arrived with the wrong secret, for the Alerts setup check.
    if (process.env.PUSH_TICK_SECRET && storeReady()) await setJson("tickRefused", Date.now()).catch(() => undefined);
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  if (!pushReady()) return Response.json({ error: "push not configured" }, { status: 503 });
  const now = Date.now();
  // Every step is guarded: one failing step must not stop the others or the
  // answer, which tells the collector when to call again.
  const errors: string[] = [];
  const step = async <T,>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      errors.push(`${name}: ${message(e)}`);
      return fallback;
    }
  };
  const tidy = await step("tidy", tidyStore, null);
  // Cook (and book) the slips as soon as a round is published, so codes are ready.
  // At most once a minute: each check reads SportyBet's upcoming list.
  const cooked = await step("cook", async () =>
    (await claim("scan:cook", 55).catch(() => true)) ? (await currentSlates()).slates.length : null, -1);
  const out = await step("tick", () => tick(buildTip, now, buildOurs), null);
  if (out?.error) errors.push(`tick: ${out.errors} failed, first: ${out.error}`);
  // Slip alerts on saved filters and templates (each account at most every 10 minutes).
  const alerts = await step("alerts", () => runWatches(now), null);
  if (alerts?.error) errors.push(`alerts: ${alerts.errors} failed, first: ${alerts.error}`);
  const error = errors.length ? errors.join("; ").slice(0, 600) : undefined;
  if (error) {
    console.error(`push tick: ${error}`);
    await setJson("tickError", { at: now, error } satisfies TickError, 7 * 86400).catch(() => undefined);
  }
  return Response.json({ ...(out ?? { next: 60 }), cooked, alerts, tidy, error });
}

/** For the collector's log: when the tick last ran, and its last error. */
export async function GET(request: Request) {
  if (!authorised(request)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const [at, err] = await Promise.all([lastTick().catch(() => null), lastTickError().catch(() => null)]);
  return Response.json({ lastTick: at, lastError: err });
}
