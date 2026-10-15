import { upcoming } from "./sportybet";
import { getJson, setJson } from "./store";

// The last prematch prices of every round, kept two days, so a code first
// opened after kickoff (booked in SportyBet, not in Vig) still shows what its
// legs were priced at. SportyBet's share endpoint gives in-play prices once a
// match starts, which Vig never shows as the code's odds. The tick saves each
// round in the 20 minutes before it kicks off, while SportyBet lists all of it.
// vFootball prices rarely move in that time.

const KEEP_SECONDS = 2 * 86400;
const AHEAD = 20 * 60_000; // SportyBet's list drops a round about 9 minutes before it kicks off
type Round = Record<string, Record<string, number>>; // eventId → market → odds

const roundKey = (kickoff: number) => `pre:${kickoff}`;

/** Save the prices of rounds kicking off within 20 minutes; returns how many rounds. */
export async function snapshotRounds(now = Date.now()): Promise<number> {
  const soon = (await upcoming()).filter((f) => f.kickoff > now && f.kickoff <= now + AHEAD);
  const rounds = new Map<number, Round>();
  for (const f of soon) rounds.set(f.kickoff, { ...rounds.get(f.kickoff), [f.eventId]: f.odds });
  for (const [kickoff, prices] of rounds) {
    // Merge: a match that drops from the list keeps its earlier price.
    const had = (await getJson<Round>(roundKey(kickoff))) ?? {};
    await setJson(roundKey(kickoff), { ...had, ...prices }, KEEP_SECONDS);
  }
  return rounds.size;
}

/** Saved prices for these legs' rounds, keyed by event. */
export async function savedPrices(kickoffs: number[]): Promise<Round> {
  const out: Round = {};
  for (const k of [...new Set(kickoffs)].slice(0, 60)) Object.assign(out, await getJson<Round>(roundKey(k)).catch(() => null));
  return out;
}
