import { legPayback } from "./bonus";
import { slipReturn } from "./money";

// Rollover: start with a stake, put the whole pot on one short-priced step each
// round, and roll the winnings into the next step until the target (or a stop).
// Pure, so the server, the Rollover screen and the tests share it.
//
// The honest arithmetic: every step pays back about 97-98% of the pot on average
// (lib/bonus.ts legPayback), so reaching ×T takes about log(T)/log(odds) steps and
// lands about (payback)^steps / T of the time. Shorter odds mean more steps but a
// slightly smaller cut each; the chance of reaching the target barely moves.

export type Band = { id: string; label: string; lo: number; hi: number; hint: string };
export const BANDS: Band[] = [
  { id: "safer", label: "Safer", lo: 1.08, hi: 1.25, hint: "Each step lands about 8-9 times in 10" },
  { id: "balanced", label: "Balanced", lo: 1.2, hi: 1.4, hint: "About 7-8 in 10 each step" },
  { id: "bolder", label: "Bolder", lo: 1.3, hi: 1.6, hint: "About 6-7 in 10, fewer steps" },
];
export const PER_STEP = [1, 2, 3] as const;
export const STEP_MINUTES = 40; // a step: wait for the round (a few minutes) + the match and its result (~33 min)

export type RLeg = {
  eventId: string; market: string; label: string; home: string; away: string; league: string;
  kickoff: number; odds: number; chance: number;
};
export type StepState = "open" | "won" | "lost" | "void";
export type Step = {
  n: number; code: string; legs: RLeg[]; odds: number; chance: number; stake: number;
  booked: number; state: StepState; back?: number; settled?: number;
};
export type RolloverStatus = "running" | "reached" | "lost" | "banked";
export type Rollover = {
  id: string; start: number; target: number; lo: number; hi: number; perStep: number;
  created: number; updated: number; status: RolloverStatus; pot: number; best: number;
  steps: Step[]; skipped: number; ended?: number;
};

/** What a step pays per ₦1 when every leg lands (SportyBet's multi-bet bonus included on 2+ legs). */
export const stepOdds = (legOdds: number[]) => slipReturn(legOdds);

/** The chance a step lands, from the legs' market chances. */
export const stepChance = (chances: number[]) => chances.reduce((a, p) => a * p, 1);

/** The typical leg in a band: its geometric middle. */
export const bandMid = (lo: number, hi: number) => Math.sqrt(lo * hi);

/** About how many steps, how long, and how often a rollover gets from `pot` to `target`. */
export function plan(pot: number, target: number, lo: number, hi: number, perStep: number) {
  if (!(pot > 0) || !(target > pot)) return { steps: 0, hours: 0, chance: 1, perStepChance: 1, perStepOdds: 1 };
  const o = bandMid(lo, hi);
  const perStepOdds = Math.pow(o, perStep);
  const perStepChance = Math.pow(legPayback(o) / o, perStep);
  const steps = Math.ceil(Math.log(target / pot) / Math.log(perStepOdds));
  return { steps, hours: (steps * STEP_MINUTES) / 60, chance: Math.pow(perStepChance, steps), perStepChance, perStepOdds };
}

/** Milestones on the way, as multiples of the start: ×10, ×100, ×1,000 ... below the target. */
export function milestones(start: number, target: number): number[] {
  const out: number[] = [];
  for (let m = 10; start * m < target; m *= 10) out.push(start * m);
  return out;
}

/** How far along, 0-1, on a log scale (doubling counts the same anywhere on the climb). */
export const progress = (start: number, pot: number, target: number) =>
  pot <= start ? 0 : pot >= target ? 1 : Math.log(pot / start) / Math.log(target / start);

export function newRollover(o: { start: number; target: number; lo: number; hi: number; perStep: number }, now = Date.now()): Rollover {
  return {
    id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, start: Math.round(o.start), target: Math.round(o.target),
    lo: o.lo, hi: o.hi, perStep: o.perStep, created: now, updated: now, status: "running", pot: Math.round(o.start),
    best: Math.round(o.start), steps: [], skipped: 0,
  };
}

/** The open step, if any. */
export const openStep = (r: Rollover) => r.steps.find((s) => s.state === "open") ?? null;

/** Add a booked step: the whole pot goes on it. */
export function addStep(r: Rollover, s: { code: string; legs: RLeg[] }, now = Date.now()): Rollover {
  if (r.status !== "running" || openStep(r)) return r;
  const step: Step = {
    n: r.steps.length + 1, code: s.code, legs: s.legs, odds: stepOdds(s.legs.map((l) => l.odds)),
    chance: stepChance(s.legs.map((l) => l.chance)), stake: r.pot, booked: now, state: "open",
  };
  return { ...r, steps: [...r.steps, step], updated: now };
}

/** Settle the open step: a landed step rolls its return into the pot; a lost one ends the run.
 * "void" (the code wasn't placed, or SportyBet voided it) gives the stake back. */
export function settleStep(r: Rollover, state: Exclude<StepState, "open">, now = Date.now()): Rollover {
  const s = openStep(r);
  if (!s) return r;
  const back = state === "won" ? Math.round(s.stake * s.odds) : state === "void" ? s.stake : 0;
  const steps = r.steps.map((x) => (x === s ? { ...x, state, back, settled: now } : x));
  const pot = state === "lost" ? 0 : back;
  const status: RolloverStatus = state === "lost" ? "lost" : pot >= r.target ? "reached" : "running";
  return { ...r, steps, pot, best: Math.max(r.best, pot), status, updated: now, ...(status !== "running" ? { ended: now } : {}) };
}

/** Take the pot and stop (between steps only). */
export function bank(r: Rollover, now = Date.now()): Rollover {
  if (r.status !== "running" || openStep(r)) return r;
  return { ...r, status: "banked", updated: now, ended: now };
}

/** A fresh run with the same settings. */
export const again = (r: Rollover, now = Date.now()) => newRollover(r, now);

/** Union of two lists by id, the latest change winning; newest first, at most 20. */
export function mergeRollovers(a: Rollover[], b: Rollover[]): Rollover[] {
  const by = new Map<string, Rollover>();
  for (const r of [...a, ...b]) {
    if (!r || typeof r.id !== "string" || !/^r[a-z0-9]{4,20}$/.test(r.id) || !Array.isArray(r.steps)) continue;
    const old = by.get(r.id);
    if (!old || r.updated > old.updated) by.set(r.id, r);
  }
  return [...by.values()].sort((x, y) => y.created - x.created).slice(0, 20);
}
