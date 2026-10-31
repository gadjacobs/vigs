import { applyHot, detectHot, hotLegs, hotPayload, nextRoundFixtures, roundsDue, type HotRound } from "./hotround";
import { loadBlend } from "./blend";
import { logBooking } from "./codelog";
import { rememberEstimates, rememberPrematch, SLATE_CODE_SECONDS } from "./codes";
import { loadInsights } from "./insights";
import { leanOf } from "./lean";
import { MARKET_LABELS } from "./markets";
import { loadModel } from "./model";
import { candidates } from "./picks";
import { loadSub, send } from "./push";
import { DEFAULT_QUERY } from "./query";
import { shareUrl } from "./share";
import { book, selection } from "./sportybet";
import { getJson, members, setJson } from "./store";

// The tick's hot-round step: judge rounds that have just finished, and for each
// one that ran hot, book an overs slip for the league's next round and tell
// everyone with hot-round alerts on (Sub.hot, on unless switched off).

export async function runHot(now = Date.now()): Promise<{ due: number; hot: number; sent: number }> {
  const due = (await roundsDue(now)).length;
  if (!due) return { due, hot: 0, sent: 0 };
  const found = await detectHot(now);
  let sent = 0;
  if (!found.length) return { due, hot: 0, sent };
  const [model, blend, ins] = await Promise.all([loadModel(), loadBlend(), loadInsights()]);
  for (const h of found) {
    const fx = await nextRoundFixtures(h);
    if (!fx.length || h.next - now < 60_000) continue;
    const q = { ...DEFAULT_QUERY, markets: Object.keys(MARKET_LABELS), hours: 3, now };
    const cands = applyHot(candidates(model, fx, q, blend).candidates, [h]);
    const legs = hotLegs(cands, h, (p) => leanOf(ins?.lean, p.market, p.marketChance).adj);
    if (legs.length >= 3) {
      try {
        const res = await book(legs.map((p) => selection(p.market, p.eventId)));
        if (res.verified === legs.length) {
          h.code = res.code; h.legs = legs.length;
          h.odds = legs.reduce((a, p) => a * p.odds, 1);
          h.chance = legs.reduce((a, p) => a * Math.min(0.99, p.marketChance + (p.hot?.adj ?? 0)), 1);
          await rememberPrematch(res.code, Object.fromEntries(legs.map((p) => [p.eventId, p.odds])), SLATE_CODE_SECONDS);
          await rememberEstimates(res.code, Object.fromEntries(legs.map((p) => [p.eventId, p.estimate])), SLATE_CODE_SECONDS);
          await logBooking(res.code, legs, "slate:hot", "vig");
        }
      } catch { /* alert without a slip */ }
    }
    // Keep the slip with the round, for the app.
    const all = (await getJson<HotRound[]>("hot:now").catch(() => null)) ?? [];
    await setJson("hot:now", all.map((x) => (x.league === h.league && x.next === h.next ? h : x)), 45 * 60).catch(() => undefined);
    const p = hotPayload(h);
    for (const id of await members("subs").catch(() => [] as string[])) {
      const s = await loadSub(id).catch(() => null);
      if (!s || s.hot === false) continue;
      if (await send(s, { ...p, url: h.code ? shareUrl(h.code) : "/picks", tag: `hot-${h.league}`, kind: "hot", code: h.code })) sent++;
    }
  }
  return { due, hot: found.length, sent };
}
