import { fairProbs } from "./markets";
import type { Pick } from "./picks";
import type { Fixture } from "./sportybet";

// The first half against its usual. Every fixture replays about daily with the
// same full-time prices, but the engine moves goals between the halves each
// replay and the first-half price follows. In 10,517 settled matches a first-half
// goal came 79% of the time when FH over 0.5 was 4+ points shorter than that
// fixture's usual, and 62% when 4+ points longer. It is already in the price,
// so it is no edge; it shows which first-half legs are likelier tonight.

export const FH_STEP = 0.015; // points of first-half goal chance that count as a move

const key = (f: { league: string; home: string; away: string }) => `${f.league}|${f.home}|${f.away}`;

/** First-half goal chance now minus the fixture's usual, per event (only fixtures with a usual). */
export function fhShifts(fixtures: Fixture[], usual: Record<string, number> | undefined): Map<string, { now: number; usual: number }> {
  const out = new Map<string, { now: number; usual: number }>();
  if (!usual) return out;
  for (const f of fixtures) {
    const u = usual[key(f)];
    const now = f.odds.FH_O05 && f.odds.FH_U05 ? fairProbs({ FH_O05: f.odds.FH_O05, FH_U05: f.odds.FH_U05 }).FH_O05 : undefined;
    if (u !== undefined && now !== undefined) out.set(f.eventId, { now, usual: u });
  }
  return out;
}

/** True when a first-half leg is likelier than usual tonight: an over when first-half
 * goals are likelier than usual, an under when they are less likely. Other legs pass. */
export function fhLikelier(p: Pick, shifts: Map<string, { now: number; usual: number }>): boolean {
  if (!p.market.startsWith("FH_")) return true;
  const s = shifts.get(p.eventId);
  if (!s) return false;
  const d = s.now - s.usual;
  return p.market.startsWith("FH_O") ? d >= FH_STEP : d <= -FH_STEP;
}

/** Marks first-half legs with their fixture's usual, and keeps only likelier ones when asked. */
export function applyFh(cands: Pick[], fixtures: Fixture[], usual: Record<string, number> | undefined, onlyLikelier: boolean): Pick[] {
  const shifts = fhShifts(fixtures, usual);
  for (const p of cands) {
    const s = p.market.startsWith("FH_") ? shifts.get(p.eventId) : undefined;
    if (s) p.fh = { now: s.now, usual: s.usual };
  }
  return onlyLikelier ? cands.filter((p) => fhLikelier(p, shifts)) : cands;
}
