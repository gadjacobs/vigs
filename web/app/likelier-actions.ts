"use server";
import { bestSlip, type Rule } from "@/lib/likelier";
import { trackCode } from "@/lib/codes";
import { fairProbs, MARKET_LABELS } from "@/lib/markets";
import { eventMarkets, upcoming, type Fixture } from "@/lib/sportybet";
import { bookSlip, type BookResult } from "./actions";

export type RebuiltLeg = {
  eventId: string; home: string; away: string; league: string; kickoff: number;
  market: string; label: string; odds: number; chance: number;
};
export type Rebuild =
  | {
      ok: true;
      original: { legs: number; odds: number; chance: number | null; started: number };
      slip: { legs: RebuiltLeg[]; odds: number; chance: number; keeps: number } | null;
      finishBy: number;
    }
  | { ok: false; error: string };

const LEAD = 4 * 60_000; // time to load the code in SportyBet before the first kick-off

/** The likeliest slip at the same payout as a code's legs still to kick off,
 * from matches that finish no later than the code's last one. */
export async function rebuildCode(code: string, rule: Rule = "any"): Promise<Rebuild> {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return { ok: false, error: "That is not a booking code." };
  if (!["any", "goals", "nodraw"].includes(rule)) rule = "any";
  try {
    const now = Date.now();
    const t = await trackCode(code, now);
    if (t.foreign) return { ok: false, error: "This code has legs outside vFootball, which Vig doesn't price." };
    const todo = t.legs.filter((l) => l.kickoff > now + LEAD && l.status === "waiting");
    if (!todo.length) return { ok: false, error: "Every leg has kicked off (or is about to), so there is nothing left to rebuild." };
    const finishBy = Math.max(...todo.map((l) => l.kickoff));

    // The code's own matches are often outside the upcoming list; read those directly.
    const listed = new Map((await upcoming()).map((f) => [f.eventId, f]));
    const missing = todo.filter((l) => !listed.has(l.eventId));
    for (let i = 0; i < missing.length; i += 10) {
      const got = await Promise.all(missing.slice(i, i + 10).map((l) => eventMarkets(l.eventId, false)));
      got.forEach((ev, k) => {
        const l = missing[i + k];
        if (ev) listed.set(l.eventId, { eventId: l.eventId, league: l.league, home: l.home, away: l.away, kickoff: l.kickoff, odds: ev.odds });
      });
    }

    // The code as it stands: its current prices and SportyBet's chance for each.
    let odds = 1, chance: number | null = 1;
    for (const l of todo) {
      const f = listed.get(l.eventId);
      const o = f?.odds[l.market] ?? l.shareOdds;
      const p = f ? fairProbs(f.odds)[l.market] : undefined;
      odds *= o;
      chance = chance !== null && p ? chance * p : null;
    }

    const pool: Fixture[] = [...listed.values()].filter((f) => f.kickoff > now + LEAD && f.kickoff <= finishBy);
    const best = bestSlip(pool, odds, rule);
    return {
      ok: true, finishBy,
      original: { legs: todo.length, odds, chance, started: t.legs.length - todo.length },
      slip: best && {
        odds: best.odds, chance: best.chance, keeps: best.keeps,
        legs: best.legs.map((l) => ({
          eventId: l.id, home: l.fixture.home, away: l.fixture.away, league: l.fixture.league, kickoff: l.fixture.kickoff,
          market: l.market, label: MARKET_LABELS[l.market] ?? l.market, odds: l.odds, chance: l.chance,
        })),
      },
    };
  } catch (e) {
    return { ok: false, error: `SportyBet did not answer (${(e as Error).message}). Try again in a minute.` };
  }
}

/** Book the rebuilt slip. Places no bet. */
export async function bookRebuild(legs: RebuiltLeg[]): Promise<BookResult> {
  const clean = legs.filter((l) => /^sr:match:\d+$/.test(l.eventId) && Number.isFinite(l.odds)).slice(0, 50);
  return bookSlip(clean.map((l) => ({
    eventId: l.eventId, market: l.market, kickoff: l.kickoff, odds: l.odds,
    estimate: l.chance, marketChance: l.chance, home: l.home, away: l.away, league: l.league,
  })), "likelier");
}
