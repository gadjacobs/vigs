import { MARKET_LABELS } from "./markets";
import { decodeShare, VFOOTBALL } from "./sportybet";
import { savedPrices } from "./prematch";
import { marketKey, score, settle } from "./settle";
import { del, getJson, setJson, storeReady } from "./store";

export type LegStatus = "waiting" | "playing" | "won" | "lost" | "unknown";
export type Leg = {
  eventId: string; league: string; home: string; away: string; kickoff: number;
  market: string; label: string; status: LegStatus; score: string | null; ht: string | null;
  // The price this code is worked out at. SportyBet's share endpoint gives the
  // prematch price only until kickoff; afterwards it returns an in-play price.
  // A leg Vig saw before kickoff keeps its prematch price. A leg already in play
  // when the code was first loaded is priced at the live price captured then
  // (`live` is true), because that is what SportyBet pays for a slip placed at
  // that moment. null when neither was seen.
  odds: number | null;
  prematch: number | null; // the prematch price, when Vig knows it (the round's last saved price for a live leg)
  live: boolean; // `odds` is a live price captured when the code was first loaded
  shareOdds: number; // what the share endpoint returned this time
};
export type CodeState = "open" | "won" | "lost";
export type Tracked = {
  code: string; legs: Leg[]; state: CodeState; won: number; lost: number; odds: number | null;
  liveLegs: number; // legs priced at a captured live price
  lastKickoff: number; deadline: number; unavailable: number;
  foreign: boolean; // has legs outside vFootball, which Vig doesn't follow
};

/** Price of a leg. Prematch wins when Vig saw it before kickoff; else a leg in
 * play when first loaded takes the live price captured then (`seen`), or the share
 * endpoint's current one the first time. Pure, so it is tested without the network. */
export function priceLeg(a: { prematch?: number; seen?: number; shareOdds: number; kickoff: number; now: number; playing: boolean }):
  { odds: number | null; live: boolean } {
  const pre = a.prematch ?? (a.kickoff > a.now && a.shareOdds > 1 ? a.shareOdds : undefined);
  if (pre) return { odds: pre, live: false };
  const live = a.seen ?? (a.playing && a.shareOdds > 1 ? a.shareOdds : undefined);
  return live ? { odds: live, live: true } : { odds: null, live: false };
}

/** Where a booked code stands, from one read of SportyBet's share endpoint. */
export async function trackCode(code: string, now = Date.now(), prematch: Record<string, number> = {}, liveSeen: Record<string, number> = {}): Promise<Tracked> {
  const d = await decodeShare(code);
  const foreign = (d.outcomes ?? []).some((e) => e.sport?.id !== undefined && e.sport.id !== VFOOTBALL);
  const legs: Leg[] = (d.outcomes ?? []).map((e) => {
    const m = e.markets?.[0];
    const o = m?.outcomes?.[0];
    const market = (m && o && marketKey(String(m.id), m.specifier, String(o.id))) || "?";
    const ft = score(e.setScore);
    const halves = e.regularTimeScore ?? e.gameScore ?? [];
    const ht = score(halves[0]);
    const kickoff = Number(e.estimateStartTime);
    let status: LegStatus = kickoff > now ? "waiting" : "playing";
    if (e.matchStatus === "End" && ft) {
      const r = market === "?" ? null : settle(market, ft[0], ft[1], ht?.[0] ?? null, ht?.[1] ?? null);
      status = r === null ? (o?.isWinning === 1 ? "won" : o?.isWinning === 0 ? "lost" : "unknown") : r ? "won" : "lost";
    }
    const shareOdds = Number(o?.odds ?? 0);
    const price = priceLeg({ prematch: prematch[e.eventId], seen: liveSeen[e.eventId], shareOdds, kickoff, now, playing: status === "playing" });
    return {
      eventId: e.eventId, league: e.sport?.category?.name ?? "", home: e.homeTeamName, away: e.awayTeamName,
      kickoff, market, label: MARKET_LABELS[market] ?? m?.desc ?? "Selection",
      odds: price.odds, prematch: price.live ? null : price.odds, live: price.live, shareOdds,
      status, score: ft ? ft.join(":") : null, ht: ht ? ht.join(":") : null,
    };
  });
  const won = legs.filter((l) => l.status === "won").length;
  const lost = legs.filter((l) => l.status === "lost").length;
  return {
    code, legs, won, lost,
    state: lost ? "lost" : legs.length && won === legs.length ? "won" : "open",
    odds: legs.length && legs.every((l) => l.odds) ? legs.reduce((a, l) => a * (l.odds as number), 1) : null,
    liveLegs: legs.filter((l) => l.live).length,
    lastKickoff: Math.max(0, ...legs.map((l) => l.kickoff)),
    deadline: Number(d.deadline ?? 0),
    unavailable: (d.unavailableOutcomes ?? []).length,
    foreign,
  };
}

/** One line for a notification or a status chip. */
export function summary(t: Tracked): string {
  if (t.state === "won") return `Every leg won: all ${t.legs.length}${t.odds ? ` at ${t.odds.toFixed(2)} odds` : ""}. Open SportyBet to see your payout.`;
  if (t.state === "lost") {
    const miss = t.legs.find((l) => l.status === "lost")!;
    return `Booking ${t.code} lost: ${miss.home} v ${miss.away}, ${miss.label.toLowerCase()}, ended ${miss.score}` +
      `${miss.market.startsWith("FH_") ? ` (${miss.ht} at half time)` : ""}. ${t.won} of ${t.legs.length} legs won` +
      `${t.won + t.lost < t.legs.length ? " so far" : ""}.`;
  }
  return `Booking ${t.code}: ${t.won} of ${t.legs.length} legs won, ${t.legs.length - t.won} to go.`;
}

// Prematch prices kept in the store: written when Vig books a code, and filled
// in whenever a code is tracked before its legs kick off. Kept two weeks, like
// the estimates below: Vig books hundreds of codes a day.
export const CODE_KEEP_SECONDS = 14 * 86400;
/** Vig's own cooked slips: kept while they play (the code log keeps their legs for the record). */
export const SLATE_CODE_SECONDS = 36 * 3600;

/** Live prices captured when a code was first loaded with legs already in play. Kept
 * three days: a code's deadline is its last kickoff plus 24 hours. */
export const LIVE_KEEP_SECONDS = 3 * 86400;

/** A cooked slip's code as the kitchen first saw it: its legs' prematch odds and Vig's estimates. */
export type SlateCode = { o: Record<string, number>; e?: Record<string, number> };
const slateCode = async (code: string) => {
  const v = await getJson<SlateCode | number>(`slatecode:${code}`).catch(() => null);
  return v && typeof v === "object" ? v : null;
};

export async function trackWithPrematch(code: string, now = Date.now()): Promise<Tracked> {
  const key = `codeodds:${code}`;
  const liveKey = `codelive:${code}`;
  const ready = storeReady();
  // A cooked slip's prices live with its claim (lib/kitchen.ts) until someone tracks it.
  const pre = (ready ? (await getJson<Record<string, number>>(key).catch(() => null)) ?? (await slateCode(code))?.o : null) ?? {};
  const seen = (ready ? await getJson<Record<string, number>>(liveKey).catch(() => null) : null) ?? {};
  const t = await trackCode(code, now, pre, seen);
  const fresh = t.legs.filter((l) => !(l.eventId in pre) && l.kickoff > now && l.shareOdds > 1);
  // A leg first seen in play keeps the live price captured now (what SportyBet
  // would pay for a slip placed now), so later loads don't drift with the match.
  const captured = t.legs.filter((l) => l.live && !(l.eventId in seen) && l.odds);
  // A leg first seen after kickoff: its round's last prematch price, saved by the tick.
  // It prices a leg only when no live price could be captured (a leg that has ended);
  // for a live leg it is kept beside the live price, to show how far the price moved.
  const late = ready ? t.legs.filter((l) => l.kickoff <= now && (l.live || l.odds === null)) : [];
  if (late.length) {
    const saved = await savedPrices(late.map((l) => l.kickoff)).catch(() => ({}) as Awaited<ReturnType<typeof savedPrices>>);
    for (const l of late) {
      const o = saved[l.eventId]?.[l.market];
      if (!o) continue;
      l.prematch = o;
      if (!l.live) { l.odds = o; fresh.push(l); }
    }
    if (t.legs.every((l) => l.odds)) t.odds = t.legs.reduce((a, l) => a * (l.odds as number), 1);
  }
  if (fresh.length && ready) {
    for (const l of fresh) pre[l.eventId] = l.odds ?? l.shareOdds;
    await setJson(key, pre, CODE_KEEP_SECONDS).catch(() => undefined);
  }
  if (captured.length && ready) {
    for (const l of captured) seen[l.eventId] = l.odds as number;
    await setJson(liveKey, seen, LIVE_KEEP_SECONDS).catch(() => undefined);
  }
  return t;
}

/** Take the live prices again: forget the ones captured at first load and read the code afresh.
 * For a slip loaded in SportyBet later than in Vig, whose in-play prices have moved. */
export async function repriceLive(code: string, now = Date.now()): Promise<Tracked> {
  if (storeReady()) await del(`codelive:${code}`).catch(() => undefined);
  return trackWithPrematch(code, now);
}

/** Vig's estimate per leg when the code was made, for share cards and the record. */
export async function rememberEstimates(code: string, est: Record<string, number>, seconds = CODE_KEEP_SECONDS) {
  if (!storeReady()) return;
  const pre = (await getJson<Record<string, number>>(`codeest:${code}`).catch(() => null)) ?? {};
  await setJson(`codeest:${code}`, { ...est, ...pre }, seconds);
}
export const loadEstimates = async (code: string) =>
  (storeReady() ? (await getJson<Record<string, number>>(`codeest:${code}`).catch(() => null)) ?? (await slateCode(code))?.e : null) ?? {};

export async function rememberPrematch(code: string, odds: Record<string, number>, seconds = CODE_KEEP_SECONDS) {
  if (!storeReady()) return;
  const key = `codeodds:${code}`;
  const pre = (await getJson<Record<string, number>>(key).catch(() => null)) ?? {};
  await setJson(key, { ...odds, ...pre }, seconds);
}
