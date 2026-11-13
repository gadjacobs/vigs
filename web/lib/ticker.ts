import { pushReady, tick, type TickError } from "./push";
import { currentSlates } from "./kitchen";
import { snapshotRounds } from "./prematch";
import { claim, setJson } from "./store";
import { tidyStore } from "./tidy";
import { buildOurs, buildTip } from "./tips";
import { runWatches } from "./watches";
import { runHot } from "./hotalert";

// One pass of the background work: cook and book the slips, save prematch
// prices, follow and settle watched codes, send notifications and slip alerts,
// keep the store tidy. Run by the collector in GitHub Actions (tools/tick.mts),
// or through /api/push/tick when the collector can't reach the store itself.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const fail = async (errors: string[], now: number) => {
  const error = errors.length ? errors.join("; ").slice(0, 600) : undefined;
  if (error) {
    console.error(`push tick: ${error}`);
    await setJson("tickError", { at: now, error } satisfies TickError, 7 * 86400).catch(() => undefined);
  }
  return error;
};
// Every step is guarded: one failing step must not stop the others or the
// answer, which tells the caller when to call again.
const guard = (errors: string[]) => async <T,>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await run();
  } catch (e) {
    errors.push(`${name}: ${message(e)}`);
    return fallback;
  }
};

/** The urgent part: follow watched codes and matches, settle them, send the news. */
export async function runFollow(now = Date.now()) {
  if (!pushReady()) return { error: "push not configured", next: 300 };
  const errors: string[] = [];
  const out = await guard(errors)("tick", () => tick(buildTip, now, buildOurs), null);
  if (out?.error) errors.push(`tick: ${out.errors} failed, first: ${out.error}`);
  return { ...(out ?? {}), next: out?.next ?? 60, error: await fail(errors, now) };
}

/** The housekeeping: cook and book slips, save prematch prices, judge hot rounds,
 * slip alerts, tidy the store. Each is gated to about once a minute or less, and
 * some take 20 seconds or more, so the collector runs them on their own loop. */
export async function runChores(now = Date.now()) {
  if (!pushReady()) return { error: "push not configured", next: 300 };
  const errors: string[] = [];
  const step = guard(errors);
  const [tidy, cooked, rounds, hot, alerts] = await Promise.all([
    step("tidy", tidyStore, null),
    // Cook (and book) the slips as soon as a round is published, so codes are ready.
    // At most once a minute: each check reads SportyBet's upcoming list.
    step("cook", async () =>
      (await claim("scan:cook", 55).catch(() => true)) ? (await currentSlates()).slates.length : null, -1),
    // The last prematch prices of the next rounds, for codes first opened after kickoff.
    step("prices", async () =>
      (await claim("scan:prematch", 50).catch(() => true)) ? await snapshotRounds(now) : null, null),
    // Hot rounds: judge rounds that have just finished (lib/hotround.ts).
    step("hot", () => runHot(now), null),
    // Slip alerts on saved filters and templates (each account at most every 10 minutes).
    step("alerts", () => runWatches(now), null),
  ]);
  if (alerts?.error) errors.push(`alerts: ${alerts.errors} failed, first: ${alerts.error}`);
  // While a round is about to finish, check every 20 s: its result is known only
  // a few minutes before the league's next round kicks off.
  return { cooked, rounds, hot, alerts, tidy, next: hot?.due ? 20 : 60, error: await fail(errors, now) };
}

/** Both at once, for /api/push/tick (one call does everything). */
export async function runTickOnce(now = Date.now()) {
  if (!pushReady()) return { error: "push not configured", next: 300 };
  const [follow, chores] = await Promise.all([runFollow(now), runChores(now)]);
  const error = [follow.error, chores.error].filter(Boolean).join("; ") || undefined;
  return { ...chores, ...follow, next: Math.min(follow.next, chores.next === 20 ? 20 : 300), error };
}
