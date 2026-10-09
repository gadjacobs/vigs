// Mirrors vigs/data.py settle(): true/false once decided, null when the data
// can't settle it (a first-half market without a half-time score).
export function settle(market: string, hg: number, ag: number, htHg: number | null, htAg: number | null): boolean | null {
  if (market === "1") return hg > ag;
  if (market === "X") return hg === ag;
  if (market === "2") return hg < ag;
  if (market === "BY") return hg > 0 && ag > 0;
  if (market === "BN") return hg === 0 || ag === 0;
  const m = /^(FH_)?([OU])(\d)(\d)$/.exec(market);
  if (!m) throw new Error(`unknown market ${market}`);
  const line = Number(m[3]) + Number(m[4]) / 10;
  let goals = hg + ag;
  if (m[1]) {
    if (htHg === null || htAg === null) return null;
    goals = htHg + htAg;
  }
  return m[2] === "O" ? goals > line : goals < line;
}

/** "2:1" → [2, 1]. */
export function score(s: unknown): [number, number] | null {
  const m = /^(\d+):(\d+)$/.exec(String(s ?? ""));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** vigs market key for a SportyBet selection; the inverse of sportybet.ts selection(). */
export function marketKey(marketId: string, specifier: string | null | undefined, outcomeId: string): string | null {
  if (marketId === "1") return ({ "1": "1", "2": "X", "3": "2" } as Record<string, string>)[outcomeId] ?? null;
  if (marketId === "29") return outcomeId === "74" ? "BY" : outcomeId === "76" ? "BN" : null;
  const t = /^total=(\d)\.(\d)$/.exec(specifier ?? "");
  if ((marketId === "18" || marketId === "68") && t && (outcomeId === "12" || outcomeId === "13"))
    return `${marketId === "68" ? "FH_" : ""}${outcomeId === "12" ? "O" : "U"}${t[1]}${t[2]}`;
  return null;
}
