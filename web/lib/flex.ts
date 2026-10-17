// Chance that at least k of n independent legs land (Poisson binomial), for
// slips with SportyBet's Flex option, which still pays (reduced) with misses.

/** dist[j] = chance exactly j legs land. */
export function landedDist(ps: number[]): number[] {
  let d = [1];
  for (const p of ps) {
    const next = new Array(d.length + 1).fill(0);
    d.forEach((x, j) => {
      next[j] += x * (1 - p);
      next[j + 1] += x * p;
    });
    d = next;
  }
  return d;
}

export function atLeast(ps: number[], k: number): number {
  return landedDist(ps).slice(Math.max(0, k)).reduce((a, b) => a + b, 0);
}

/** Which legs to keep so that "all but `miss`" lands at least `target` of the
 * time: drop the least likely leg, one at a time, but keep at least `min` legs.
 * Returns the kept indices in their original order. */
export function flexFriendly(ps: number[], target = 0.5, miss = 2, min = 4): number[] {
  let keep = ps.map((_, i) => i);
  while (keep.length > min && atLeast(keep.map((i) => ps[i]), keep.length - miss) < target) {
    const worst = keep.reduce((w, i) => (ps[i] < ps[w] ? i : w), keep[0]);
    keep = keep.filter((i) => i !== worst);
  }
  return keep;
}

// SportyBet's Flex odds, as its own site works them out (betslip code and its
// flexiBetConfig, read 17 Oct 2026): odds = payback / chance, where chance is
// that at least `minWins` legs land by SportyBet's own leg chances and payback is
// a set figure, 0.65 for virtual games (oddsKey). So whatever the legs, Flex on
// vFootball returns about ₦0.65 per ₦1 by SportyBet's reckoning: a 4-leg, 20-odds
// slip with one miss allowed (3 of 4 land about 25% of the time) pays about 2.6.
// A straight slip returns about 0.96 per leg (₦0.96 for one leg, ₦0.66 for 10,
// ₦0.44 for 20), so Flex only returns more on slips of more than about 10 legs.
export const FLEX_PAYBACK = 0.65;

export type FlexQuote = { odds: number; chance: number; payback: number };

/** Flex odds for "at least `minWins` of these legs land", from each leg's chance
 * (our de-vigged market chance stands in for SportyBet's own). */
export function flexQuote(ps: number[], minWins: number): FlexQuote | null {
  if (!ps.length || minWins < 1 || minWins > ps.length) return null;
  const chance = atLeast(ps, minWins);
  return chance > 0 ? { odds: FLEX_PAYBACK / chance, chance, payback: FLEX_PAYBACK } : null;
}
