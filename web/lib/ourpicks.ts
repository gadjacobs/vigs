import type { Pick } from "./picks";
import { confidence } from "./plain";
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
export type SetId = "safe" | "odds" | "bold" | "draws";
export const SETS: { id: SetId; label: string }[] = [
  { id: "safe", label: "Safe ~90%" },
  { id: "odds", label: "Target odds" },
  { id: "bold", label: "Bold" },
  { id: "draws", label: "Draws + Flex" },
];
export const OUR_BARS = [0.85, 0.88, 0.9, 0.93] as const;
export const OUR_DEFAULT = 0.88;
export const TARGETS = [2, 5, 10, 20] as const;
export const COUNTS = [2, 3, 4, 5, 6] as const;

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

export function buildSet(id: SetId, cands: Pick[], o: { bar: number; target: number; n: number; maxSlip: number }): Built {
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
  if (id === "draws") {
    const pool = cands.filter((p) => p.market === "X").sort((a, b) => b.estimate - a.estimate);
    return { pool, slip: pool.slice(0, o.n), flex: true };
  }
  const pool = ourPicks(cands, o.bar);
  return { pool, slip: pool.slice(0, o.maxSlip), flex: false };
}
