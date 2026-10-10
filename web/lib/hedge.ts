// Hedging the last leg of a slip: a single bet on the opposite outcome at
// SportyBet's current price. Vig only does the arithmetic and books the code;
// the bet itself is placed (or not) by the user in SportyBet.

/** The selection that wins exactly when `market` loses. 1X2 legs are covered
 * by double chance, which SportyBet offers as one selection. */
export function opposite(market: string): string | null {
  const dc: Record<string, string> = { "1": "DCX2", X: "DC12", "2": "DC1X" };
  if (dc[market]) return dc[market];
  if (market === "BY") return "BN";
  if (market === "BN") return "BY";
  const m = /^(FH_)?([OU])(\d\d)$/.exec(market);
  return m ? `${m[1] ?? ""}${m[2] === "O" ? "U" : "O"}${m[3]}` : null;
}

export type HedgePlan = {
  cover: { stake: number; net: number }; // the same result whichever way the leg goes
  back: { stake: number; ifLands: number } | null; // your stake back if the leg fails
  hold: { average: number | null }; // keep the slip as it is
  coverCost: number | null; // what covering gives up on average, by SportyBet's own chance
};

/**
 * stake: what the slip cost; payout: what it returns if it lands; odds: price
 * of the opposite selection; p: chance the leg lands (SportyBet's, or null).
 * All results are net of every naira staked (slip plus hedge).
 */
export function hedgePlan(stake: number, payout: number, odds: number, p: number | null): HedgePlan {
  const coverStake = payout / odds; // leg lands: payout; leg fails: coverStake * odds = payout
  const coverNet = payout - coverStake - stake;
  const backStake = odds > 1 ? stake / (odds - 1) : Infinity; // leg fails: backStake * odds = stake + backStake
  const back = Number.isFinite(backStake) && backStake < coverStake
    ? { stake: backStake, ifLands: payout - backStake - stake } : null;
  const average = p === null ? null : p * payout - stake;
  return {
    cover: { stake: coverStake, net: coverNet },
    back,
    hold: { average },
    coverCost: average === null ? null : average - coverNet,
  };
}

/** Naira, rounded up to the nearest 10 for a stake, so the cover is never short. */
export const stakeUp = (x: number) => Math.ceil(x / 10) * 10;
