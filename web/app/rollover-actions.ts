"use server";
import { loadBlend } from "@/lib/blend";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel } from "@/lib/model";
import { candidates, type Pick } from "@/lib/picks";
import { upcoming } from "@/lib/sportybet";
import type { RLeg } from "@/lib/rollover";

export type StepOffer = { kickoff: number; legs: RLeg[]; alts: RLeg[]; rounds: number[] } | { error: string };

const asLeg = (p: Pick): RLeg => ({
  eventId: p.eventId, market: p.market, label: MARKET_LABELS[p.market] ?? p.market, home: p.home, away: p.away,
  league: p.league, kickoff: p.kickoff, odds: p.odds, chance: p.marketChance,
});

/**
 * The next rollover step: in the soonest round (or a later one, `skip` rounds on)
 * that kicks off at least two minutes from now, the likeliest selections priced
 * inside the band, one per match, by SportyBet's own chance. `alts` are the next
 * likeliest in the same round, for swapping a leg.
 */
export async function nextStep(o: { lo: number; hi: number; perStep: number; skip?: number }): Promise<StepOffer> {
  const lo = Math.max(1.01, Number(o.lo) || 1.2), hi = Math.min(5, Math.max(lo + 0.01, Number(o.hi) || 1.4));
  const k = Math.min(3, Math.max(1, Math.round(Number(o.perStep) || 1)));
  const now = Date.now();
  try {
    const [model, fixtures, blend] = await Promise.all([loadModel(), upcoming(), loadBlend()]);
    const all = candidates(model, fixtures, {
      markets: Object.keys(MARKET_LABELS), hours: 3, minOdds: lo, maxOdds: hi, minGrade: "Rough", now: now + 2 * 60_000,
    }, blend).candidates.filter((p) => p.odds >= lo && p.odds <= hi && p.grade !== "Avoid");
    // Rounds by kickoff, soonest first, keeping only those with enough matches for the step.
    const byRound = new Map<number, Pick[]>();
    for (const p of all) (byRound.get(p.kickoff) ?? byRound.set(p.kickoff, []).get(p.kickoff)!).push(p);
    const rounds = [...byRound.keys()].sort((a, b) => a - b)
      .filter((t) => new Set(byRound.get(t)!.map((p) => p.eventId)).size >= k);
    if (!rounds.length) return { error: "No round coming up has selections in this price range. Try a wider range, or check back when the next round is published." };
    const t = rounds[Math.min(Math.max(0, Math.round(Number(o.skip) || 0)), rounds.length - 1)];
    // The likeliest selection per match, then the likeliest matches.
    const best = new Map<string, Pick>();
    for (const p of byRound.get(t)!.sort((a, b) => b.marketChance - a.marketChance))
      if (!best.has(p.eventId)) best.set(p.eventId, p);
    const ranked = [...best.values()];
    return { kickoff: t, legs: ranked.slice(0, k).map(asLeg), alts: ranked.slice(k, k + 6).map(asLeg), rounds: rounds.slice(0, 6) };
  } catch {
    return { error: "SportyBet or the model file did not answer. Try again in a minute." };
  }
}

export type RolloverMark = { n: number; stake: number; odds: number; kept: number; target: number };

/** Remember a booked step for two days, so the result notification can speak
 * of the rollover ("Step 6 landed, next step ready") and open its screen. */
export async function markStep(code: string, m: RolloverMark): Promise<void> {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return;
  const { setJson, storeReady } = await import("@/lib/store");
  if (!storeReady()) return;
  const n = (x: unknown) => Math.max(0, Math.round(Number(x) || 0));
  await setJson(`rostep:${code}`, { n: n(m.n), stake: n(m.stake), odds: Math.max(1, Number(m.odds) || 1), kept: n(m.kept), target: n(m.target) }, 2 * 86400)
    .catch(() => undefined);
}
