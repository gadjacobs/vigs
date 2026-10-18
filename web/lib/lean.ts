import type { LeanRow } from "./insights";

// A market's record at a chance level (insights.json `lean`): how often it has
// landed against its de-vigged price in our data. Pure, so pages and the slip
// builder share it.

const SHRINK = 2000; // examples at which a market's record counts half

/** The market's record at this chance, its excess landing rate per selection
 * shrunk toward zero when examples are few, and its z-score. */
export function leanOf(lean: LeanRow[] | undefined, market: string, chance: number): { adj: number; z: number | null; row: LeanRow | null } {
  const r = lean?.find((x) => x.market === market && chance >= x.lo && chance < x.hi) ?? null;
  if (!r || !r.n) return { adj: 0, z: null, row: null };
  // A market whose lean didn't hold up on later days keeps its record but no nudge.
  if (r.held === false) return { adj: 0, z: r.z, row: r };
  return { adj: ((r.landed - r.priced) / r.n) * (r.n / (r.n + SHRINK)), z: r.z, row: r };
}

/** Markets whose record at this chance level is at or above their price (z >= 0)
 * and whose lean held up on later days,
 * from at least `minN` settled examples; null without a record to go on. */
export function marketsAtOrAbove(lean: LeanRow[] | undefined, lo: number, hi: number, minN = 1000): Set<string> | null {
  if (!lean?.length) return null;
  // The chance levels whose middle falls in [lo, hi), combined per market.
  const by = new Map<string, { n: number; landed: number; priced: number; held: boolean }>();
  for (const r of lean) {
    const mid = (r.lo + Math.min(r.hi, 1)) / 2;
    if (mid < lo || mid >= hi) continue;
    const a = by.get(r.market) ?? { n: 0, landed: 0, priced: 0, held: true };
    by.set(r.market, { n: a.n + r.n, landed: a.landed + r.landed, priced: a.priced + r.priced, held: a.held && r.held !== false });
  }
  return new Set([...by].filter(([, a]) => a.n >= minN && a.landed >= a.priced && a.held).map(([m]) => m));
}
