import { pushReady, tick, type TickError } from "./push";
import { currentSlates } from "./kitchen";
import { snapshotRounds } from "./prematch";
import { claim, setJson } from "./store";
import { tidyStore } from "./tidy";
import { buildOurs, buildTip } from "./tips";
import { runWatches } from "./watches";

// One pass of the background work: cook and book the slips, save prematch
// prices, follow and settle watched codes, send notifications and slip alerts,
// keep the store tidy. Run by the collector in GitHub Actions (tools/tick.mts),
// or through /api/push/tick when the collector can't reach the store itself.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function runTickOnce(now = Date.now()) {
  if (!pushReady()) return { error: "push not configured", next: 300 };
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
  // The last prematch prices of the next rounds, for codes first opened after kickoff.
  const rounds = await step("prices", async () =>
    (await claim("scan:prematch", 50).catch(() => true)) ? await snapshotRounds(now) : null, null);
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
  return { ...(out ?? { next: 60 }), cooked, rounds, alerts, tidy, error };
}
