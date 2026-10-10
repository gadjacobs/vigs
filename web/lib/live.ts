import { fairProbs } from "./markets";
import { eventMarkets, liveBoard, upcoming, type LiveEvent } from "./sportybet";

// Live state of booked legs: score, clock and the chance each leg (and the
// whole slip) still lands, from SportyBet's own live probabilities.

export type LegRef = { eventId: string; market: string; kickoff: number };
export type LiveLeg = {
  state: "waiting" | "playing" | "ended"; // ended: no longer in play; the share endpoint settles it
  phase: string | null; minute: number | null; score: string | null; fh: string | null;
  chance: number | null; // 1 or 0 once the score decides it
  odds: number | null; // live price of this selection, while it is offered
};

const GOALS = /^(FH_)?([OU])(\d)(\d)$/;
const PAST_HALF = new Set(["HT", "H2", "End", "Ended"]);

/** True or false once the score already decides the selection, else null.
 * A full-time 1X2 or under line is only decided at the end; overs and both
 * teams to score can land early, and unders and BTTS No can be lost early. */
export function decided(market: string, ev: Pick<LiveEvent, "phase" | "score" | "fh">): boolean | null {
  const s = ev.score;
  if (!s) return null;
  const m = GOALS.exec(market);
  if (m) {
    const half = Boolean(m[1]);
    const g = half ? (ev.fh ?? s) : s;
    const goals = g[0] + g[1];
    const line = Number(m[3]) + Number(m[4]) / 10;
    const final = half && ev.fh !== null && PAST_HALF.has(ev.phase);
    if (goals > line) return m[2] === "O";
    return final ? m[2] === "U" : null;
  }
  if (market === "BY" && s[0] > 0 && s[1] > 0) return true;
  if (market === "BN" && s[0] > 0 && s[1] > 0) return false;
  return null;
}

const fmt = (s: [number, number] | null) => (s ? `${s[0]}:${s[1]}` : null);

/** Chance a leg still lands, from a live event. */
export function legChance(market: string, ev: LiveEvent): number | null {
  const d = decided(market, ev);
  if (d !== null) return d ? 1 : 0;
  return ev.prob[market] ?? null;
}

/** Product of leg chances; null when any open leg has no chance yet. */
export function slipChance(chances: (number | null)[]): number | null {
  let p = 1;
  for (const c of chances) {
    if (c === null) return null;
    p *= c;
  }
  return p;
}

const BOARD_MARKETS = /^([1X2]|O\d\d|U\d\d)$/; // what the live list carries; the rest needs the event feed

/** Live state for each leg, keyed "eventId|market". One read of the live list,
 * plus the single-event feed for first-half and both-teams-score legs. */
export async function liveLegs(legs: LegRef[], now = Date.now()): Promise<Record<string, LiveLeg>> {
  const out: Record<string, LiveLeg> = {};
  const started = legs.filter((l) => l.kickoff <= now);
  const waiting = legs.filter((l) => l.kickoff > now);
  const board = started.length ? await liveBoard() : new Map<string, LiveEvent>();
  const extra = new Map<string, LiveEvent | null>();
  for (const l of started) {
    const ev = board.get(l.eventId);
    if (ev && !BOARD_MARKETS.test(l.market) && !extra.has(l.eventId) && extra.size < 10)
      extra.set(l.eventId, await eventMarkets(l.eventId, true));
  }
  for (const l of started) {
    const key = `${l.eventId}|${l.market}`;
    const base = board.get(l.eventId);
    // A match that has just kicked off can be missing for a moment; one gone a
    // while after kickoff has ended.
    if (!base) {
      out[key] = { state: now - l.kickoff < 3 * 60_000 ? "playing" : "ended", phase: null, minute: null, score: null, fh: null, chance: null, odds: null };
      continue;
    }
    const ev = extra.get(l.eventId) ?? base;
    const full = { ...ev, phase: base.phase, minute: base.minute, score: base.score, fh: base.fh };
    out[key] = {
      state: "playing", phase: base.phase, minute: base.minute, score: fmt(base.score), fh: fmt(base.fh),
      chance: legChance(l.market, full), odds: full.odds[l.market] ?? null,
    };
  }
  if (waiting.length) {
    const fx = new Map((await upcoming().catch(() => [])).map((f) => [f.eventId, f]));
    for (const l of waiting) {
      const f = fx.get(l.eventId);
      out[`${l.eventId}|${l.market}`] = {
        state: "waiting", phase: null, minute: null, score: null, fh: null,
        chance: f ? fairProbs(f.odds)[l.market] ?? null : null, odds: f?.odds[l.market] ?? null,
      };
    }
  }
  return out;
}
