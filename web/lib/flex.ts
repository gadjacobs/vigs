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
