import { MARKET_LABELS } from "./markets";
import { decodeShare } from "./sportybet";
import { marketKey, score, settle } from "./settle";
import { getJson, setJson, storeReady } from "./store";

export type LegStatus = "waiting" | "playing" | "won" | "lost" | "unknown";
export type Leg = {
  eventId: string; league: string; home: string; away: string; kickoff: number;
  market: string; label: string; status: LegStatus; score: string | null; ht: string | null;
  // Prematch price. SportyBet's share endpoint gives the prematch price only
  // until kickoff; afterwards it returns a different, in-play price, so that one
  // is never shown. null when Vig never saw the leg before kickoff.
  odds: number | null;
  shareOdds: number; // what the share endpoint returned this time
};
export type CodeState = "open" | "won" | "lost";
export type Tracked = {
  code: string; legs: Leg[]; state: CodeState; won: number; lost: number; odds: number | null;
  lastKickoff: number; deadline: number; unavailable: number;
};

/** Where a booked code stands, from one read of SportyBet's share endpoint. */
export async function trackCode(code: string, now = Date.now(), prematch: Record<string, number> = {}): Promise<Tracked> {
  const d = await decodeShare(code);
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
    return {
      eventId: e.eventId, league: e.sport?.category?.name ?? "", home: e.homeTeamName, away: e.awayTeamName,
      kickoff, market, label: MARKET_LABELS[market] ?? m?.desc ?? "Selection",
      odds: prematch[e.eventId] ?? (kickoff > now && o?.odds ? Number(o.odds) : null), shareOdds: Number(o?.odds ?? 0),
      status, score: ft ? ft.join(":") : null, ht: ht ? ht.join(":") : null,
    };
  });
  const won = legs.filter((l) => l.status === "won").length;
  const lost = legs.filter((l) => l.status === "lost").length;
  return {
    code, legs, won, lost,
    state: lost ? "lost" : legs.length && won === legs.length ? "won" : "open",
    odds: legs.length && legs.every((l) => l.odds) ? legs.reduce((a, l) => a * (l.odds as number), 1) : null,
    lastKickoff: Math.max(0, ...legs.map((l) => l.kickoff)),
    deadline: Number(d.deadline ?? 0),
    unavailable: (d.unavailableOutcomes ?? []).length,
  };
}

/** One line for a notification or a status chip. */
export function summary(t: Tracked): string {
  if (t.state === "won") return `Booking ${t.code} landed: all ${t.legs.length} legs won${t.odds ? ` at ${t.odds.toFixed(2)}` : ""}.`;
  if (t.state === "lost") {
    const miss = t.legs.find((l) => l.status === "lost")!;
    return `Booking ${t.code} lost: ${miss.home} v ${miss.away}, ${miss.label.toLowerCase()}, ended ${miss.score}` +
      `${miss.market.startsWith("FH_") ? ` (${miss.ht} at half time)` : ""}. ${t.won} of ${t.legs.length} legs won` +
      `${t.won + t.lost < t.legs.length ? " so far" : ""}.`;
  }
  return `Booking ${t.code}: ${t.won} of ${t.legs.length} legs won, ${t.legs.length - t.won} to go.`;
}

// Prematch prices kept in the store: written when Vig books a code, and filled
// in whenever a code is tracked before its legs kick off.

export async function trackWithPrematch(code: string, now = Date.now()): Promise<Tracked> {
  const key = `codeodds:${code}`;
  const pre = (storeReady() ? await getJson<Record<string, number>>(key).catch(() => null) : null) ?? {};
  const t = await trackCode(code, now, pre);
  const fresh = t.legs.filter((l) => !(l.eventId in pre) && l.kickoff > now && l.shareOdds > 1);
  if (fresh.length && storeReady()) {
    for (const l of fresh) pre[l.eventId] = l.shareOdds;
    await setJson(key, pre).catch(() => undefined);
  }
  return t;
}

/** Vig's estimate per leg when the code was made, for share cards and the record. */
export async function rememberEstimates(code: string, est: Record<string, number>) {
  if (!storeReady()) return;
  const pre = (await getJson<Record<string, number>>(`codeest:${code}`).catch(() => null)) ?? {};
  await setJson(`codeest:${code}`, { ...est, ...pre });
}
export const loadEstimates = async (code: string) =>
  (storeReady() ? await getJson<Record<string, number>>(`codeest:${code}`).catch(() => null) : null) ?? {};

export async function rememberPrematch(code: string, odds: Record<string, number>) {
  if (!storeReady()) return;
  const key = `codeodds:${code}`;
  const pre = (await getJson<Record<string, number>>(key).catch(() => null)) ?? {};
  await setJson(key, { ...odds, ...pre });
}
