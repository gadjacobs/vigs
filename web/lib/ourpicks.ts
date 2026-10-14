import type { LeanRow } from "./insights";
import { leanOf } from "./lean";
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
// - top: 50 of the likeliest selections, one per match, leaning toward markets
//   that have landed above their price at that chance level (see `lean`).
// - trusted: the same, only where the bookmaker's price and the model agree
//   closely (High confidence) and the market's record at that level is at or
//   above its price, and a chance of 60% or more.
export type SetId = "top" | "trusted" | "best" | "safe" | "odds" | "bold" | "draws";
export const SETS: { id: SetId; label: string }[] = [
  { id: "top", label: "Top 50 likeliest" },
  { id: "trusted", label: "Most confident" },
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
export const FLOOR_DEFAULT = 1.1;
const TRUSTED_MIN = 0.6; // "most confident" legs are likely ones too; the slip takes as many as qualify

/** One leg per match, the likeliest after the lean, best first. */
export function topPicks(cands: Pick[], lean: LeanRow[] | undefined, floor: number, trusted: boolean): Pick[] {
  const score = (p: Pick) => p.marketChance + leanOf(lean, p.market, p.marketChance).adj;
  const ok = (p: Pick) => {
    if (p.odds < floor) return false;
    if (!trusted) return true;
    const z = leanOf(lean, p.market, p.marketChance).z;
    return p.marketChance >= TRUSTED_MIN && confidence(p.lo, p.hi) === "High" && z !== null && z >= 0;
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

export type Built = { pool: Pick[]; slip: Pick[]; flex: boolean };

export function buildSet(id: SetId, cands: Pick[], o: { bar: number; target: number; n: number; maxSlip: number; floor?: number; lean?: LeanRow[] }): Built {
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
