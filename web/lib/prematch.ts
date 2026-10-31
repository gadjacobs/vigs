import { upcoming, type Fixture } from "./sportybet";
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
  // The fixtures themselves (teams, league) too, for the hot-round slip: by the
  // time a round's result is known the next round can be off SportyBet's list.
  const byKo = new Map<number, Fixture[]>();
  for (const f of soon) byKo.set(f.kickoff, [...(byKo.get(f.kickoff) ?? []), f]);
  for (const [kickoff, fx] of byKo) {
    const had = (await getJson<Fixture[]>(`prefx:${kickoff}`)) ?? [];
    const ids = new Set(fx.map((f) => f.eventId));
    await setJson(`prefx:${kickoff}`, [...had.filter((f) => !ids.has(f.eventId)), ...fx], 6 * 3600);
  }
  if (byKo.size) {
    const known = ((await getJson<number[]>("prefx:index")) ?? []).filter((k) => k > now - 3 * 3600_000);
    await setJson("prefx:index", [...new Set([...known, ...byKo.keys()])].sort((a, b) => a - b), 6 * 3600);
  }
  return rounds.size;
}

/** Saved fixtures (with prices) of the rounds kicking off at these times. */
export async function savedFixtures(kickoffs: number[]): Promise<Fixture[]> {
  const out: Fixture[] = [];
  for (const k of [...new Set(kickoffs)].slice(0, 20)) out.push(...((await getJson<Fixture[]>(`prefx:${k}`).catch(() => null)) ?? []));
  return out;
}
export const savedRoundTimes = async () => (await getJson<number[]>("prefx:index").catch(() => null)) ?? [];

/** Saved prices for these legs' rounds, keyed by event. */
export async function savedPrices(kickoffs: number[]): Promise<Round> {
  const out: Round = {};
  for (const k of [...new Set(kickoffs)].slice(0, 60)) Object.assign(out, await getJson<Round>(roundKey(k)).catch(() => null));
  return out;
}
