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
