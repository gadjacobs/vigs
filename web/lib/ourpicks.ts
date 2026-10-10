import type { Pick } from "./picks";

// Our picks: for every published match, the best-paying selection that still
// has about a 90% chance (Vig estimate at or above the bar). Mirrors
// `vigs ourpicks`, which logs the same list to the ledger every hour.
export const OUR_BARS = [0.85, 0.88, 0.9, 0.93] as const;
export const OUR_DEFAULT = 0.88;

export function ourPicks(cands: Pick[], bar = OUR_DEFAULT): Pick[] {
  const best = new Map<string, Pick>();
  for (const p of cands) {
    if (p.estimate < bar) continue;
    const b = best.get(p.eventId);
    if (!b || p.odds > b.odds || (p.odds === b.odds && p.estimate > b.estimate)) best.set(p.eventId, p);
  }
  return [...best.values()].sort((a, b) => a.kickoff - b.kickoff || b.estimate - a.estimate);
}
