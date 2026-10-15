import { loadBlend } from "./blend";
import { atLeast } from "./flex";
import { loadInsights } from "./insights";
import { MARKET_LABELS } from "./markets";
import { loadModel } from "./model";
import { buildSet, FLOOR_DEFAULT, TOP_COUNTS } from "./ourpicks";
import { candidates, type Pick } from "./picks";
import { chance, oneIn } from "./plain";
import type { Profile } from "./profile";
import { send, type Payload, type Sub } from "./push";
import { DEFAULT_QUERY, parseQuery, queryString } from "./query";
import { slipStats, toTarget, topN, MAX_LEGS } from "./slip";
import { upcoming } from "./sportybet";
import { claim, getJson, members, setJson } from "./store";

// Slip alerts: an account asks to hear when a saved Tonight filter, or one of the
// Our picks templates, comes up with a slip that meets its conditions. Checked
// about every 10 minutes per account by the tick; each alert is sent at most
// every 2 hours and only when its slip has changed, never between 00:00 and
// 07:00 Lagos, to every device on the account.

export type SlipWatch = {
  id: string;
  source: string;        // "filter:<saved filter name>" | "template:top" | "template:trusted"
  minLegs: number;       // at least this many legs (for a template: that many qualify)
  minChance?: number;    // all legs land at least this often (0-1)
  minOdds?: number;      // total odds at least this
};
export const TEMPLATE_NAMES: Record<string, string> = { "template:top": "Top 50 likeliest", "template:trusted": "Most confident" };
export const watchName = (w: { source: string }) =>
  TEMPLATE_NAMES[w.source] ?? (w.source.startsWith("filter:") ? `“${w.source.slice(7)}”` : w.source);

const EVERY = 2 * 3600_000;
const SCAN_SECONDS = 600;

const lagosHour = (now: number) => (new Date(now).getUTCHours() + 1) % 24;
const lagos = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);

/** The slip an alert would send now, or null when it doesn't meet the conditions. */
export function judge(w: SlipWatch, legs: Pick[]): { legs: Pick[]; odds: number; chance: number } | null {
  const slip = w.source.startsWith("template:") ? legs.slice(0, w.minLegs) : legs;
  if (slip.length < Math.max(1, w.minLegs)) return null;
  const s = slipStats(slip);
  if (w.minChance && s.model < w.minChance) return null;
  if (w.minOdds && s.odds < w.minOdds) return null;
  return { legs: slip, odds: s.odds, chance: s.model };
}

/** A short signature of the legs, so an unchanged slip isn't sent twice. */
export const signature = (legs: Pick[]) => legs.map((p) => p.id).sort().join(",");

/** True when an alert may be sent: daytime in Lagos, a new slip, and 2 hours since the last. */
export function mayTell(last: { at: number; sig: string } | null, sig: string, now: number): boolean {
  const h = lagosHour(now);
  if (h < 7) return false;
  return !last || (last.sig !== sig && now - last.at >= EVERY);
}

type Ctx = { cands: (hours: number, q?: ReturnType<typeof parseQuery>) => Promise<Pick[]>; lean: Awaited<ReturnType<typeof loadInsights>> };

async function context(now: number): Promise<Ctx> {
  const [model, fixtures, blend, insights] = await Promise.all([loadModel(), upcoming(), loadBlend(), loadInsights()]);
  return {
    lean: insights,
    cands: async (hours, q) => candidates(model, fixtures, { ...(q ?? { ...DEFAULT_QUERY, markets: Object.keys(MARKET_LABELS) }), hours, now }, blend).candidates,
  };
}

/** The payload for one alert, or null when nothing qualifies now. */
async function evaluate(w: SlipWatch, p: Profile, ctx: Ctx, now: number): Promise<{ payload: Payload; sig: string } | null> {
  if (w.source.startsWith("template:")) {
    const set = w.source === "template:trusted" ? "trusted" : "top";
    const legs = buildSet(set, await ctx.cands(24), { bar: 0, target: 0, n: MAX_LEGS, maxSlip: MAX_LEGS, floor: FLOOR_DEFAULT, lean: ctx.lean?.lean }).slip;
    const hit = judge(w, legs);
    if (!hit) return null;
    const n = hit.legs.length;
    const flex = n >= 4 ? ` With Flex, ${n - 2} of ${n} land ${chance(atLeast(hit.legs.map((l) => l.estimate), n - 2))} of the time.` : "";
    const pick = TOP_COUNTS.find((c) => c >= n) ?? 50;
    return {
      sig: signature(hit.legs),
      payload: {
        title: `Vig: ${watchName(w)}, ${legs.length} legs qualify`,
        body: `The top ${n} at ${hit.odds.toFixed(2)} odds: all land ${chance(hit.chance)} of the time (${oneIn(hit.chance)}).${flex} First kick-off ${lagos(Math.min(...hit.legs.map((l) => l.kickoff)))}. Tap to review and book.`,
        url: `/picks?tab=build&set=${set}&n=${pick}`, tag: `watch-${w.id}`,
      },
    };
  }
  const name = w.source.slice(7);
  const f = (p.filters ?? []).find((x) => x.name === name);
  if (!f) return null;
  const q = parseQuery(Object.fromEntries(new URLSearchParams(f.qs)));
  const cands = await ctx.cands(q.hours, q);
  const legs = q.mode === "target" ? toTarget(cands, q.target, q.tol, q.maxLegs || MAX_LEGS) : topN(cands, q.count, q.sort);
  const hit = judge(w, legs);
  if (!hit) return null;
  return {
    sig: signature(hit.legs),
    payload: {
      title: `Vig: ${watchName(w)} is ready`,
      body: `${hit.legs.length} legs at ${hit.odds.toFixed(2)} odds, all land ${chance(hit.chance)} of the time (${oneIn(hit.chance)}). First kick-off ${lagos(Math.min(...hit.legs.map((l) => l.kickoff)))}. Tap to review and book.`,
      url: `/?${queryString(q)}`, tag: `watch-${w.id}`,
    },
  };
}

/** One pass over every account with slip alerts and a device to send to. */
export async function runWatches(now = Date.now()): Promise<{ checked: number; sent: number; errors: number; error?: string }> {
  const out: { checked: number; sent: number; errors: number; error?: string } = { checked: 0, sent: 0, errors: 0 };
  const ids = await members("subs").catch(() => [] as string[]);
  const byUser = new Map<string, Sub[]>();
  for (const id of ids) {
    const s = await getJson<Sub>(`sub:${id}`).catch(() => null);
    if (s?.user) byUser.set(s.user, [...(byUser.get(s.user) ?? []), s]);
  }
  let ctx: Ctx | null = null;
  for (const [user, subs] of byUser) {
    const p = await getJson<Profile>(`profile:${user}`).catch(() => null);
    if (!p?.watches?.length) continue;
    if (!(await claim(`scan:watch:${user}`, SCAN_SECONDS).catch(() => false))) continue;
    ctx ??= await context(now);
    for (const w of p.watches) {
      out.checked++;
      try {
        const r = await evaluate(w, p, ctx, now);
        if (!r) continue;
        const key = `watchsent:${user}:${w.id}`;
        if (!mayTell(await getJson<{ at: number; sig: string }>(key), r.sig, now)) continue;
        let ok = false;
        for (const s of subs) ok = (await send(s, r.payload).catch(() => false)) || ok;
        if (ok) { out.sent++; await setJson(key, { at: now, sig: r.sig }); }
      } catch (e) {
        out.errors++;
        out.error ??= (e instanceof Error ? e.message : String(e)).slice(0, 200);
      }
    }
  }
  return out;
}
