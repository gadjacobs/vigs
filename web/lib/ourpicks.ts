import type { LeanRow } from "./insights";
import { LEAN_ON, leanOf } from "./lean";
import { multiBonus } from "./bonus";
import { flexQuote } from "./flex";
export { leanOf } from "./lean";
import type { Pick } from "./picks";
import { confidence } from "./plain";
import { bestPerMatch } from "./slates";
import { toTarget } from "./slip";

// Our picks: ready-made sets, each from what the data has shown so far.
// - safe: per match, the best-paying selection with a chance of at least the
//   bar (88% default). Mirrors `vigs ourpicks`, logged hourly.
// - odds: a slip at a total-odds target built from legs priced 1.25 to 2.2 with
//   Medium or High confidence. Backing every selection, prices under 2 lost
//   1-2% while prices over 5 lost 24-48% (favourite-longshot bias), so a total
//   built from several short legs keeps more value than one long shot.
// - bold: legs at 1.8 or more where the market and model agree (High confidence).
// - draws: the likeliest draws (evenly matched games, more often in Spain and
//   Italy), with the chance that at least k of n land for SportyBet's Flex.
// - best: the best bet per match, ranked by the bookmaker's de-vigged chance
//   at odds of 1.2 or more, with no market filling more than 40% of the slip.
// - top: 50 of the likeliest selections, one per match.
// - trusted: the same, only where the bookmaker's price and the model agree
//   closely (High confidence), with a chance of 60% or more.
// - goal: one straight bonus slip sized to turn the stake into a goal in a
//   single bet. Every bet gives the bookmaker its cut, so when the aim is to
//   reach a set sum, one slip that pays it gives the best chance (bold play);
//   many small bets pay the cut many times over.
export type SetId = "goal" | "bonus" | "top" | "trusted" | "flex" | "best" | "safe" | "odds" | "bold" | "draws";
export const SETS: { id: SetId; label: string }[] = [
  { id: "goal", label: "Goal" },
  { id: "bonus", label: "Bonus slip" },
  { id: "top", label: "Most likely" },
  { id: "trusted", label: "Most confident" },
  { id: "flex", label: "Flex big odds" },
  { id: "best", label: "Best per match" },
  { id: "safe", label: "Safe ~90%" },
  { id: "odds", label: "Target odds" },
  { id: "bold", label: "Bold" },
  { id: "draws", label: "Draws + Flex" },
];
export const OUR_BARS = [0.85, 0.88, 0.9, 0.93] as const;
export const OUR_DEFAULT = 0.88;
export const TARGETS = [2, 5, 10, 20] as const;
export const COUNTS = [2, 3, 4, 5, 6] as const;
export const BEST_COUNTS = [5, 10, 20, 30, 50] as const;
export const TOP_COUNTS = [10, 20, 30, 40, 50] as const;
export const FLOORS = [1.05, 1.1, 1.2, 1.3] as const; // lowest price a leg may have
// 1.20: SportyBet's multi-bet bonus counts only legs priced 1.20 or more (lib/bonus.ts).
export const FLOOR_DEFAULT = 1.2;
// Bonus slips: legs priced just over SportyBet's 1.20 bonus line, one per match.
// At 1.20-1.25 SportyBet's prices pay back about 97.7% per leg, the most of any
// leg that counts for the bonus (1.5-1.7: about 96.9%; 38,395 matches to 31 Oct
// 2026), and its bonus keeps a slip's payback near its legs' at any length up to
// 50 (lib/bonus.ts). No market at these prices landed apart from its price once
// errors were clustered by round (docs/research-2026-10-31.md).
export const BONUS_COUNTS = [10, 20, 30, 33, 35] as const;
export const BONUS_BAND: [number, number] = [1.2, 1.25];
const BONUS_WIDER = [1.3, 1.35]; // when the band runs short of matches
// Goal: what the stake should become, as a multiple of it.
export const GOALS = [2, 5, 10, 50, 100, 1000] as const;
export const FLEX_TARGETS = [50, 100, 500, 1000] as const; // Flex odds to reach
export const FLEX_MISSES = [1, 2, 3] as const;
export const FLEX_FLOORS = [1.1, 1.2, 1.3, 1.5, 1.8] as const;
const TRUSTED_MIN = 0.6; // "most confident" legs are likely ones too; the slip takes as many as qualify

/** One leg per match, the likeliest after the lean, best first. */
export function topPicks(cands: Pick[], lean: LeanRow[] | undefined, floor: number, trusted: boolean): Pick[] {
  const score = (p: Pick) => p.marketChance + leanOf(lean, p.market, p.marketChance).adj + (p.hot?.adj ?? 0);
  const ok = (p: Pick) => {
    if (p.odds < floor) return false;
    if (!trusted) return true;
    // Without the published record (before the first hourly publish), agreement and chance alone.
    const z = leanOf(lean, p.market, p.marketChance).z;
    const recordOk = !LEAN_ON || !lean?.length || (z !== null && z >= 0);
    return p.marketChance >= TRUSTED_MIN && confidence(p.lo, p.hi) === "High" && recordOk;
  };
  return onePerMatch(cands.filter(ok), score);
}

export function ourPicks(cands: Pick[], bar = OUR_DEFAULT): Pick[] {
  const best = new Map<string, Pick>();
  for (const p of cands) {
    if (p.estimate < bar) continue;
    const b = best.get(p.eventId);
    if (!b || p.odds > b.odds || (p.odds === b.odds && p.estimate > b.estimate)) best.set(p.eventId, p);
  }
  return [...best.values()].sort((a, b) => a.kickoff - b.kickoff || b.estimate - a.estimate);
}

/** One selection per match: the one ranking highest by `key`. */
function onePerMatch(ps: Pick[], key: (p: Pick) => number): Pick[] {
  const best = new Map<string, Pick>();
  for (const p of ps) {
    const b = best.get(p.eventId);
    if (!b || key(p) > key(b)) best.set(p.eventId, p);
  }
  return [...best.values()].sort((a, b) => key(b) - key(a));
}

/** What a straight slip pays per ₦1 when every leg lands, SportyBet's bonus included. */
export const goalOdds = (legs: Pick[]) => multiBonus(legs.map((p) => ({ odds: p.odds, p: p.marketChance }))).totalOdds;

/** The fewest of `ranked` (likeliest first) whose odds with the bonus reach `target`; all of them if none do. */
export function goalSlip(ranked: Pick[], target: number, max: number): Pick[] {
  const top = ranked.slice(0, max);
  for (let k = 1; k <= top.length; k++) if (goalOdds(top.slice(0, k)) >= target) return top.slice(0, k);
  return top;
}

export type Built = { pool: Pick[]; slip: Pick[]; flex: boolean };

export function buildSet(id: SetId, cands: Pick[], o: { bar: number; target: number; n: number; maxSlip: number; floor?: number; lean?: LeanRow[]; misses?: number }): Built {
  if (id === "bonus" || id === "goal") {
    // Likeliest leg per match inside the band (widening to 1.30, then 1.35, if it runs short).
    // Double chance is left out: SportyBet prices it with a smaller cut, so its bonus formula tops it up less.
    const pick = (hi: number) => onePerMatch(cands.filter((p) => p.odds >= BONUS_BAND[0] && p.odds < hi && p.grade !== "Avoid" && !p.market.startsWith("DC")), (p) => p.marketChance + leanOf(o.lean, p.market, p.marketChance).adj + (p.hot?.adj ?? 0));
    if (id === "bonus") {
      let pool = pick(BONUS_BAND[1]);
      for (const hi of BONUS_WIDER) if (pool.length < o.n) pool = pick(hi);
      return { pool, slip: pool.slice(0, o.n), flex: false };
    }
    let pool: Pick[] = [];
    let slip: Pick[] = [];
    for (const hi of [BONUS_BAND[1], ...BONUS_WIDER]) {
      pool = pick(hi);
      slip = goalSlip(pool, o.target, o.maxSlip);
      if (slip.length && goalOdds(slip) >= o.target) break;
    }
    return { pool, slip, flex: false };
  }
  if (id === "flex") {
    // The likeliest leg per match at the price floor, most likely first, added
    // until the Flex odds with `misses` allowed reach the target. Flex returns
    // about the same per ₦1 whichever legs reach it (lib/flex.ts), so the floor
    // only sets how many legs that takes.
    const ranked = topPicks(cands, o.lean, o.floor ?? FLOOR_DEFAULT, false);
    const misses = o.misses ?? 1;
    let slip = ranked.slice(0, Math.min(ranked.length, o.maxSlip));
    for (let k = misses + 2; k <= Math.min(ranked.length, o.maxSlip); k++) {
      const q = flexQuote(ranked.slice(0, k).map((p) => p.marketChance), k - misses);
      if (q && q.odds >= o.target) { slip = ranked.slice(0, k); break; }
    }
    return { pool: ranked, slip, flex: true };
  }
  if (id === "top" || id === "trusted") {
    const legs = topPicks(cands, o.lean, o.floor ?? FLOOR_DEFAULT, id === "trusted");
    // Each match's six likeliest selections stay available, so legs can be switched or added.
    const by = new Map<string, Pick[]>();
    for (const p of cands) if (p.odds >= (o.floor ?? FLOOR_DEFAULT)) (by.get(p.eventId) ?? by.set(p.eventId, []).get(p.eventId)!).push(p);
    const pool = [...by.values()].flatMap((ps) => ps.sort((a, b) => b.marketChance - a.marketChance).slice(0, 6));
    for (const l of legs) if (!pool.includes(l)) pool.push(l);
    return { pool, slip: legs.slice(0, o.n), flex: true };
  }
  if (id === "odds") {
    const pool = cands.filter((p) => p.odds >= 1.25 && p.odds <= 2.2 && confidence(p.lo, p.hi) !== "Low");
    return { pool, slip: toTarget(pool, o.target, 0.1, 12), flex: false };
  }
  if (id === "bold") {
    const pool = onePerMatch(
      cands.filter((p) => p.odds >= 1.8 && p.estimate >= 0.35 && confidence(p.lo, p.hi) === "High"),
      (p) => p.estimate,
    );
    return { pool, slip: pool.slice(0, o.n), flex: false };
  }
  if (id === "best") {
    const pool = bestPerMatch(cands.filter((p) => p.odds >= 1.2), o.n);
    return { pool, slip: pool.slice(0, o.n), flex: false };
  }
  if (id === "draws") {
    const pool = cands.filter((p) => p.market === "X").sort((a, b) => b.estimate - a.estimate);
    return { pool, slip: pool.slice(0, o.n), flex: true };
  }
  const pool = ourPicks(cands, o.bar);
  return { pool, slip: pool.slice(0, o.maxSlip), flex: false };
}
