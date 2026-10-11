import { pushReady, tick } from "@/lib/push";
import { currentSlates } from "@/lib/kitchen";
import { claim, setJson, storeReady } from "@/lib/store";
import { buildOurs, buildTip } from "@/lib/tips";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by the collector every few minutes with PUSH_TICK_SECRET.
export async function POST(request: Request) {
  const secret = process.env.PUSH_TICK_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    // Note that a call arrived with the wrong secret, for the Alerts setup check.
    if (secret && storeReady()) await setJson("tickRefused", Date.now()).catch(() => undefined);
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  if (!pushReady()) return Response.json({ error: "push not configured" }, { status: 503 });
  // Cook (and book) the slips as soon as a round is published, so codes are ready.
  // At most once a minute: each check reads SportyBet's upcoming list.
  const cooked = (await claim("scan:cook", 55).catch(() => true))
    ? await currentSlates().then((c) => c.slates.length).catch(() => -1) : null;
  return Response.json({ ...(await tick(buildTip, Date.now(), buildOurs)), cooked });
}
