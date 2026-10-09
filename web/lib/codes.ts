import { MARKET_LABELS } from "./markets";
import { decodeShare } from "./sportybet";
import { marketKey, score, settle } from "./settle";

export type LegStatus = "waiting" | "playing" | "won" | "lost" | "unknown";
export type Leg = {
  eventId: string; league: string; home: string; away: string; kickoff: number;
  market: string; label: string; odds: number; status: LegStatus; score: string | null; ht: string | null;
};
export type CodeState = "open" | "won" | "lost";
export type Tracked = {
  code: string; legs: Leg[]; state: CodeState; won: number; lost: number; odds: number;
  lastKickoff: number; deadline: number; unavailable: number;
};

/** Where a booked code stands, from one read of SportyBet's share endpoint. */
export async function trackCode(code: string, now = Date.now()): Promise<Tracked> {
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
      kickoff, market, label: MARKET_LABELS[market] ?? m?.desc ?? "Selection", odds: Number(o?.odds ?? 1),
      status, score: ft ? ft.join(":") : null, ht: ht ? ht.join(":") : null,
    };
  });
  const won = legs.filter((l) => l.status === "won").length;
  const lost = legs.filter((l) => l.status === "lost").length;
  return {
    code, legs, won, lost,
    state: lost ? "lost" : legs.length && won === legs.length ? "won" : "open",
    odds: legs.reduce((a, l) => a * l.odds, 1),
    lastKickoff: Math.max(0, ...legs.map((l) => l.kickoff)),
    deadline: Number(d.deadline ?? 0),
    unavailable: (d.unavailableOutcomes ?? []).length,
  };
}

/** One line for a notification or a status chip. */
export function summary(t: Tracked): string {
  if (t.state === "won") return `Booking ${t.code} landed: all ${t.legs.length} legs won at ${t.odds.toFixed(2)}.`;
  if (t.state === "lost") {
    const miss = t.legs.find((l) => l.status === "lost")!;
    return `Booking ${t.code} lost: ${miss.home} v ${miss.away}, ${miss.label.toLowerCase()}, ended ${miss.score}` +
      `${miss.market.startsWith("FH_") ? ` (${miss.ht} at half time)` : ""}. ${t.won} of ${t.legs.length} legs won` +
      `${t.won + t.lost < t.legs.length ? " so far" : ""}.`;
  }
  return `Booking ${t.code}: ${t.won} of ${t.legs.length} legs won, ${t.legs.length - t.won} to go.`;
}
