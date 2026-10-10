"use server";
import { liveLegs, type LegRef, type LiveLeg } from "@/lib/live";
import { opposite } from "@/lib/hedge";
import { book, eventMarkets, selection } from "@/lib/sportybet";

const KEY = /^(1|X|2|BY|BN|(FH_)?[OU]\d\d)$/;

/** Live score, clock and chance for the legs of open codes. The Codes tab calls
 * this every few seconds while something is in play. */
export async function liveCodes(legs: LegRef[]): Promise<Record<string, LiveLeg>> {
  const clean = legs
    .filter((l) => l && /^sr:match:\d+$/.test(l.eventId) && KEY.test(l.market) && Number.isFinite(l.kickoff))
    .slice(0, 80);
  return liveLegs(clean).catch(() => ({}));
}

export type HedgeQuote = { market: string; odds: number; chance: number | null; live: boolean } | null;

/** The current price of the selection that wins when this leg loses, and
 * SportyBet's own chance that the leg lands. */
export async function hedgeQuote(eventId: string, market: string, kickoff: number): Promise<HedgeQuote> {
  const opp = opposite(market);
  if (!opp || !/^sr:match:\d+$/.test(eventId)) return null;
  const live = kickoff <= Date.now();
  const ev = await eventMarkets(eventId, live);
  const odds = ev?.odds[opp];
  if (!ev || !odds) return null;
  return { market: opp, odds, chance: ev.prob[market] ?? null, live };
}

/** A booking code with just the hedge selection, to load in SportyBet. */
export async function bookHedge(eventId: string, market: string): Promise<{ code: string } | { error: string }> {
  const opp = opposite(market);
  if (!opp || !/^sr:match:\d+$/.test(eventId)) return { error: "This leg can't be hedged." };
  try {
    const { code, verified } = await book([selection(opp, eventId)]);
    return verified ? { code } : { error: "SportyBet no longer offers this selection." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
