// SportyBet's multi-bet bonus, as its betslip works it out (plan type 2, read
// 17 Oct 2026 from /api/ng/promotion/v2/bonus/plans/valid and its betslip code).
// Paid only on a straight multiple when every leg lands (not on Flex):
//  - legs priced 1.20 or more qualify; n = how many qualify;
//  - ratio = (the qualifying legs' odds-weighted average payback ÷ their combined
//    payback) − 1, rounded down to whole percent, where a leg's payback is its odds ×
//    SportyBet's chance for it. So the bonus tops a multiple back up toward the value
//    of a single, within a range set for n (below); vFootball is not on SportyBet's
//    per-sport list, so its range is not scaled down (football's top is × 0.6);
//  - bonus = stake × (combined odds of the qualifying legs) × ratio.
// Our de-vigged market chance stands in for SportyBet's own leg chance.

export const BONUS_MIN_ODDS = 1.2;
export const BONUS_RANGES: Record<number, [number, number]> = { 2: [0, 0.03], 3: [0, 0.05], 4: [0, 0.08], 5: [0.05, 0.12], 6: [0.07, 0.16], 7: [0.07, 0.2], 8: [0.1, 0.25], 9: [0.1, 0.3], 10: [0.1, 0.33], 11: [0.15, 0.35], 12: [0.15, 0.37], 13: [0.15, 0.4], 14: [0.15, 0.42], 15: [0.15, 0.45], 16: [0.25, 0.5], 17: [0.25, 0.55], 18: [0.3, 0.6], 19: [0.3, 0.65], 20: [0.3, 0.7], 21: [0.35, 0.75], 22: [0.35, 0.8], 23: [0.35, 0.85], 24: [0.4, 0.9], 25: [0.4, 0.95], 26: [0.4, 1], 27: [0.45, 1.1], 28: [0.45, 1.2], 29: [0.5, 1.3], 30: [0.5, 1.6], 31: [0.5, 1.8], 32: [0.55, 1.9], 33: [0.55, 2], 34: [0.6, 2.1], 35: [0.6, 2.2], 36: [0.6, 2.3], 37: [0.65, 2.4], 38: [0.65, 2.5], 39: [0.7, 2.6], 40: [0.7, 2.7], 41: [0.7, 2.8], 42: [0.75, 2.9], 43: [0.75, 3], 44: [0.8, 3], 45: [0.8, 3], 46: [0.85, 3], 47: [0.85, 3], 48: [0.9, 3], 49: [0.9, 3], 50: [1, 3] };

export type Bonus = {
  qualifying: number;   // legs at 1.20 or more
  ratio: number;        // e.g. 0.5 = +50% of the qualifying odds
  extra: number;        // bonus per ₦1 staked, paid on top when every leg lands
  totalOdds: number;    // what ₦1 returns with the bonus when every leg lands
  payback: number;      // average return per ₦1, bonus included, by the market's chances
};

export function multiBonus(legs: { odds: number; p: number }[]): Bonus {
  const all = legs.reduce((a, l) => a * l.odds, 1);
  const q = legs.filter((l) => l.odds >= BONUS_MIN_ODDS);
  const n = q.length;
  const range = BONUS_RANGES[n];
  let ratio = 0;
  if (range && n >= 2) {
    const rtp = q.reduce((a, l) => a * l.odds * l.p, 1);
    const target = q.reduce((a, l) => a + l.odds * l.odds * l.p, 0) / q.reduce((a, l) => a + l.odds, 0);
    const raw = rtp > 0 ? Math.floor(100 * (target / rtp - 1)) / 100 : 0;
    ratio = Math.min(Math.max(raw, range[0]), range[1]);
  }
  const extra = q.reduce((a, l) => a * l.odds, 1) * ratio;
  const chance = legs.reduce((a, l) => a * l.p, 1);
  return { qualifying: n, ratio, extra: n >= 2 ? extra : 0, totalOdds: all + (n >= 2 ? extra : 0), payback: (all + (n >= 2 ? extra : 0)) * chance };
}
