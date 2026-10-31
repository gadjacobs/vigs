import { fairProbs } from "./markets";
import type { Pick } from "./picks";
import { savedFixtures, savedPrices, savedRoundTimes } from "./prematch";
import { results, type Fixture } from "./sportybet";
import { claim, getJson, setJson } from "./store";

// Hot rounds. When a league's round ends with more goals than its prices
// expected (at least +0.2 a match), overs in that league's NEXT round have
// landed more often than priced: +1.2% over 31 Oct's 36,961 matches, on both
// halves of the data (z 3.7 each), and gone by the round after (see
// docs/research-2026-10-31.md). Small next to each leg's cut, but real.
// Rounds are 38 minutes apart and a match takes about 30, so the result is
// known a few minutes before the next round kicks off.

export const HOT_MIN = 0.2; // goals a match over the prices' expectation
export const HOT_LIFT = 0.012; // overs land 1.2% (relative) more often
const MIN = 60_000;

export type HotRound = {
  league: string; kickoff: number; // the round that ran hot
  resid: number; matches: number; // goals a match over expected, how many matches
  next: number; // the next round's kickoff
  code?: string; legs?: number; odds?: number; chance?: number; // its overs slip, when booked
};

const OVER = /^(FH_|H_|A_)?O\d\d$/;
const UNDER = /^(FH_|H_|A_)?U\d\d$/;

/** Expected goals from a match's prices: the sum of P(team over k.5) for k = 0..4, both teams. */
export function expectedGoals(odds: Record<string, number>): number | null {
  const p = fairProbs(odds);
  if (p.H_O05 === undefined || p.A_O05 === undefined) return null;
  let x = 0;
  for (let k = 0; k <= 4; k++) x += (p[`H_O${k}5`] ?? 0) + (p[`A_O${k}5`] ?? 0);
  return x;
}

/** A round's goals a match over (or under) what its prices expected, from the matches priced. */
export function roundResidual(rows: { hg: number; ag: number; odds?: Record<string, number> }[]): { resid: number; matches: number } {
  let sum = 0, n = 0;
  for (const r of rows) {
    const x = r.odds ? expectedGoals(r.odds) : null;
    if (x === null) continue;
    sum += r.hg + r.ag - x;
    n++;
  }
  return { resid: n ? sum / n : 0, matches: n };
}

/** The adjustment to a leg's chance in a hot league's next round: overs up, unders down. */
export function hotAdj(market: string, chance: number): number {
  if (OVER.test(market)) return HOT_LIFT * chance;
  if (UNDER.test(market)) return -HOT_LIFT * (1 - chance);
  return 0;
}

/** Mark (and adjust) legs in a hot league's next round. */
export function applyHot(cands: Pick[], hot: HotRound[]): Pick[] {
  for (const p of cands) {
    const h = hot.find((x) => x.league === p.league && x.next === p.kickoff);
    const adj = h ? hotAdj(p.market, p.marketChance) : 0;
    if (!h || !adj) continue;
    p.hot = { adj, resid: h.resid };
    p.estimate = Math.min(0.99, Math.max(0.01, p.estimate + adj));
    p.lo = Math.min(0.99, Math.max(0.01, p.lo + adj));
    p.hi = Math.min(0.99, Math.max(0.01, p.hi + adj));
  }
  return cands;
}

/** Hot rounds whose next round hasn't kicked off yet (written by the tick). */
export async function currentHot(now = Date.now()): Promise<HotRound[]> {
  const all = (await getJson<HotRound[]>("hot:now").catch(() => null)) ?? [];
  return all.filter((h) => h.next > now);
}

/** Rounds that kicked off 24-40 minutes ago and haven't been judged: results due now. */
export async function roundsDue(now = Date.now()): Promise<number[]> {
  return (await savedRoundTimes()).filter((k) => k <= now - 24 * MIN && k >= now - 40 * MIN);
}

/**
 * Judge every round due now: once all its matches have results, work out its
 * goals against its prices and, if it ran hot, note its league's next round.
 * Returns the hot rounds found this pass (each league and round once).
 */
export async function detectHot(now = Date.now()): Promise<HotRound[]> {
  const due = await roundsDue(now);
  if (!due.length) return [];
  const [res, fixtures, prices, times] = await Promise.all([
    results(Math.min(...due) - MIN, Math.max(...due) + MIN), savedFixtures(due), savedPrices(due), savedRoundTimes(),
  ]);
  const found: HotRound[] = [];
  for (const k of due) {
    for (const league of new Set(fixtures.filter((f) => f.kickoff === k).map((f) => f.league))) {
      const fx = fixtures.filter((f) => f.kickoff === k && f.league === league);
      const done = res.filter((r) => r.kickoff === k && r.league === league);
      if (!fx.length || done.length < fx.length) continue; // still playing
      if (!(await claim(`hot:judged:${league}:${k}`, 6 * 3600).catch(() => false))) continue;
      const { resid, matches } = roundResidual(done.map((r) => ({ ...r, odds: prices[r.eventId] })));
      if (matches < 5 || resid < HOT_MIN) continue;
      // The league's next round: the earliest saved one still to kick off.
      const next = (await savedFixtures(times.filter((t) => t > k && t > now))).filter((f) => f.league === league)
        .map((f) => f.kickoff).sort((a, b) => a - b)[0];
      if (next) found.push({ league, kickoff: k, resid, matches, next });
    }
  }
  if (found.length) {
    const keep = (await currentHot(now)).filter((h) => !found.some((f) => f.league === h.league && f.next === h.next));
    await setJson("hot:now", [...keep, ...found], 45 * 60);
  }
  return found;
}

/** The next round's fixtures for a hot league, from the saved prices. */
export async function nextRoundFixtures(h: HotRound): Promise<Fixture[]> {
  return (await savedFixtures([h.next])).filter((f) => f.league === h.league);
}

const lagosTime = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);

/**
 * The overs slip for a hot league's next round: in each match, the likeliest
 * over at 1.20 or more (so every leg counts for SportyBet's multi-bet bonus),
 * ranked by its market chance plus the lean and hot-round adjustments.
 */
export function hotLegs(cands: Pick[], h: HotRound, leanAdj: (p: Pick) => number): Pick[] {
  const by = new Map<string, Pick>();
  const score = (p: Pick) => p.marketChance + leanAdj(p) + (p.hot?.adj ?? 0);
  for (const p of cands) {
    if (p.league !== h.league || p.kickoff !== h.next || !OVER.test(p.market) || p.odds < 1.2 || p.grade === "Avoid") continue;
    const b = by.get(p.eventId);
    if (!b || score(p) > score(b)) by.set(p.eventId, p);
  }
  return [...by.values()].sort((a, b) => score(b) - score(a));
}

/** The alert for a hot round, once its slip is booked. */
export function hotPayload(h: HotRound): { title: string; body: string } {
  const slip = h.code
    ? ` Overs slip ${h.code}: ${h.legs} legs at ${h.odds!.toFixed(2)}, ${Math.round(h.chance! * 1000) / 10}% chance all land.`
    : "";
  return {
    title: `🔥 ${h.league} ran hot: next round ${lagosTime(h.next)}`,
    body: `Its ${lagosTime(h.kickoff)} round scored ${h.resid >= 0 ? "+" : ""}${h.resid.toFixed(2)} goals a match over its prices. ` +
      `After rounds like this, the next round's overs have landed about 1.2% more often than priced.${slip}`,
  };
}
