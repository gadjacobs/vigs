import { loadEstimates, trackWithPrematch } from "./codes";
import type { ShareData } from "./sharetext";

/** Everything a share card needs for a code: legs with prematch prices, and
 * Vig's chance when Vig knew every leg's estimate before kickoff. */
export async function shareData(code: string, stake?: number): Promise<ShareData> {
  const [t, est] = await Promise.all([trackWithPrematch(code), loadEstimates(code)]);
  const known = t.legs.every((l) => est[l.eventId] !== undefined);
  return {
    code, odds: t.odds, state: t.state, stake,
    chance: known && t.legs.length ? t.legs.reduce((a, l) => a * est[l.eventId], 1) : null,
    legs: t.legs.map((l) => ({ home: l.home, away: l.away, label: l.label, odds: l.odds, kickoff: l.kickoff, status: l.status, score: l.score })),
  };
}
