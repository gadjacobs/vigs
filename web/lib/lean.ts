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
  return { adj: ((r.landed - r.priced) / r.n) * (r.n / (r.n + SHRINK)), z: r.z, row: r };
}

/** Markets whose record at this chance level is at or above their price (z >= 0),
 * from at least `minN` settled examples; null without a record to go on. */
export function marketsAtOrAbove(lean: LeanRow[] | undefined, lo: number, hi: number, minN = 1000): Set<string> | null {
  if (!lean?.length) return null;
  return new Set(lean.filter((r) => r.lo >= lo && r.hi <= hi + 1e-9 && r.n >= minN && r.z >= 0).map((r) => r.market));
}
