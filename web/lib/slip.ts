import type { Pick } from "./picks";

// Slips hold at most one selection per match. Legs on different matches are
// treated as independent, so a slip's chance is the product of its legs'.

export type SortKey = "likely" | "edge";

/** Combined odds, Vig estimate, market chance and edge of a slip. */
export function slipStats(picks: Pick[]) {
  const odds = picks.reduce((a, p) => a * p.odds, 1);
  const model = picks.reduce((a, p) => a * p.estimate, 1);
  const market = picks.reduce((a, p) => a * p.marketChance, 1);
  return { odds, model, market, edge: model * odds - 1 };
}
const key = (s: SortKey) => (p: Pick) => (s === "edge" ? p.edge : p.estimate);

/** The best `n` selections, one per match. */
export function topN(cands: Pick[], n: number, sort: SortKey): Pick[] {
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const p of [...cands].sort((a, b) => key(sort)(b) - key(sort)(a))) {
    if (seen.has(p.eventId)) continue;
    seen.add(p.eventId);
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * The slip whose combined odds land in [target, target * (1 + slack)] with the
 * highest combined Vig estimate. For a given total price that is also the best
 * expected return. Exact multiple-choice knapsack over log-odds.
 */
export function toTarget(cands: Pick[], target: number, slack = 0.25, maxLegs = 30): Pick[] {
  const R = 0.005; // log-odds resolution
  const lo = Math.ceil(Math.log(target) / R);
  const hi = Math.floor(Math.log(target * (1 + slack)) / R);
  if (hi < 1) return [];
  const groups = new Map<string, Pick[]>();
  for (const p of cands) {
    if (p.odds <= 1 || p.estimate <= 0) continue;
    (groups.get(p.eventId) ?? groups.set(p.eventId, []).get(p.eventId)!).push(p);
  }
  const gs = [...groups.values()];
  const NEG = -Infinity;
  // best[w] = max sum of log(estimate) reaching weight w; legs[w] tracks leg count.
  let best = new Float64Array(hi + 1).fill(NEG);
  let legs = new Int16Array(hi + 1);
  best[0] = 0;
  const choice: Int32Array[] = [];
  for (const g of gs) {
    const nb = Float64Array.from(best);
    const nl = Int16Array.from(legs);
    const ch = new Int32Array(hi + 1).fill(-1);
    g.forEach((p, i) => {
      const w = Math.max(1, Math.round(Math.log(p.odds) / R));
      const v = Math.log(p.estimate);
      for (let x = hi; x >= w; x--) {
        if (best[x - w] === NEG || legs[x - w] >= maxLegs) continue;
        const cand = best[x - w] + v;
        if (cand > nb[x]) {
          nb[x] = cand;
          nl[x] = legs[x - w] + 1;
          ch[x] = i;
        }
      }
    });
    choice.push(ch);
    best = nb;
    legs = nl;
  }
  let at = -1;
  for (let x = lo; x <= hi; x++) if (best[x] !== NEG && (at < 0 || best[x] > best[at])) at = x;
  if (at < 0) return [];
  const out: Pick[] = [];
  for (let gi = gs.length - 1; gi >= 0 && at > 0; gi--) {
    const i = choice[gi][at];
    if (i < 0) continue;
    const p = gs[gi][i];
    out.push(p);
    at -= Math.max(1, Math.round(Math.log(p.odds) / R));
  }
  return out.reverse();
}

/**
 * Replace one leg. Keeps the slip's price steady: among selections not already
 * on the slip (another match, or another market on the same match), prefer
 * those within 15% of the leg's odds and take the most likely; otherwise the
 * closest price.
 */
export function smartSwitch(slipPicks: Pick[], cands: Pick[], legId: string): Pick | null {
  const leg = slipPicks.find((p) => p.id === legId);
  if (!leg) return null;
  const used = new Set(slipPicks.filter((p) => p.id !== legId).map((p) => p.eventId));
  const pool = cands.filter((p) => p.id !== legId && !used.has(p.eventId));
  if (!pool.length) return null;
  const near = pool.filter((p) => Math.abs(Math.log(p.odds / leg.odds)) <= Math.log(1.15));
  if (near.length) return near.reduce((a, b) => (b.estimate > a.estimate ? b : a));
  return pool.reduce((a, b) =>
    Math.abs(Math.log(b.odds / leg.odds)) < Math.abs(Math.log(a.odds / leg.odds)) ? b : a,
  );
}
