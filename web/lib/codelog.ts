import { push, storeReady } from "./store";

export type BookedLeg = {
  eventId: string; market: string; kickoff: number;
  odds?: number; estimate?: number; marketChance?: number; lo?: number; hi?: number;
  home?: string; away?: string; league?: string;
};

/** Append a booking, stamped with the server's clock, to the code log the
 * collector copies into the ledger. Legs that had kicked off by then are not scored. */
export async function logBooking(code: string, legs: BookedLeg[], origin: string, user: string | null) {
  if (!storeReady()) return;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  await push("codelog", {
    code, user, origin: origin.slice(0, 40), booked_at: Date.now(),
    legs: legs.slice(0, 60).map((l) => ({
      event_id: String(l.eventId), market: String(l.market), kickoff: num(l.kickoff), odds: num(l.odds),
      estimate: num(l.estimate), market_prob: num(l.marketChance), ci_low: num(l.lo), ci_high: num(l.hi),
      home: String(l.home ?? ""), away: String(l.away ?? ""), league: String(l.league ?? ""),
    })),
  });
}
