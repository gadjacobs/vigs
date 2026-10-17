import { loadBlend } from "./blend";
import { rememberEstimates, rememberPrematch } from "./codes";
import { logBooking } from "./codelog";
import { MARKET_LABELS } from "./markets";
import { loadInsights } from "./insights";
import { loadModel } from "./model";
import { candidates } from "./picks";
import { DEFAULT_QUERY } from "./query";
import { buildSet } from "./ourpicks";
import { cookSlates, type Slate } from "./slates";
import { book, selection, upcoming } from "./sportybet";
import { claim, getJson, setJson, storeReady } from "./store";

// Cooks the named slips once per newly published round, books each one, and
// keeps them in the store so every viewer (and the notifications) see the same
// slips and codes. Without a store they are cooked per server instance.

export type Cooked = { round: string; cooked_at: number; slates: Slate[]; templates?: { set: string; code: string; legs: number }[] };
const FRESH = 15 * 60 * 1000;
let memory: Cooked | null = null;

async function roundKey(now: number) {
  const ids = (await upcoming()).filter((f) => f.kickoff > now).map((f) => f.eventId).sort().join(",");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function cook(round: string, now: number, bookCodes: boolean): Promise<Cooked> {
  const [model, fixtures, blend, insights] = await Promise.all([loadModel(), upcoming(), loadBlend(), loadInsights()]);
  const q = { ...DEFAULT_QUERY, markets: Object.keys(MARKET_LABELS), hours: 4, now };
  const cands = candidates(model, fixtures, q, blend).candidates;
  const slates = cookSlates(cands, insights?.lean);
  const templates: NonNullable<Cooked["templates"]> = [];
  if (bookCodes) {
    for (const s of slates) {
      try {
        const res = await book(s.legs.map((p) => selection(p.market, p.eventId)));
        if (res.verified !== s.legs.length) continue;
        s.code = res.code;
        await rememberPrematch(res.code, Object.fromEntries(s.legs.map((p) => [p.eventId, p.odds])));
        await rememberEstimates(res.code, Object.fromEntries(s.legs.map((p) => [p.eventId, p.estimate])));
        // Same legs give the same code (only within a round: later rounds have other
        // matches), so a day-long claim logs each code to the record once.
        if (await claim(`slatecode:${res.code}`, 86400)) await logBooking(res.code, s.legs, `slate:${s.style}`, "vig");
      } catch { /* leave this slip without a code; it can still be booked from the editor */ }
    }
  }
  // The Most likely and Most confident templates are booked and logged too (not shown here), so Record
  // can score them like the cooked slips: each at its default length.
  if (bookCodes) {
    for (const [set, n] of [["top", 50], ["trusted", 20]] as const) {
      const legs = buildSet(set, cands, { bar: 0, target: 0, n, maxSlip: n, lean: insights?.lean }).slip;
      if (legs.length < 3) continue;
      try {
        const res = await book(legs.map((p) => selection(p.market, p.eventId)));
        if (res.verified !== legs.length) continue;
        templates.push({ set, code: res.code, legs: legs.length });
        await rememberPrematch(res.code, Object.fromEntries(legs.map((p) => [p.eventId, p.odds])));
        if (await claim(`slatecode:${res.code}`, 86400)) await logBooking(res.code, legs, `template:${set}`, "vig");
      } catch { /* try again next round */ }
    }
  }
  return { round, cooked_at: now, slates, templates };
}

/** The current cooked slips, cooking (and booking) them if the round changed. */
export async function currentSlates(now = Date.now()): Promise<Cooked> {
  const round = await roundKey(now);
  if (!storeReady()) {
    if (memory?.round === round && now - memory.cooked_at < FRESH) return memory;
    memory = await cook(round, now, false);
    return memory;
  }
  const stored = await getJson<Cooked>("slates").catch(() => null);
  if (stored?.round === round) return stored;
  if (!(await claim("slates:cooking", 90).catch(() => false))) {
    return stored ?? (await cook(round, now, false));
  }
  const fresh = await cook(round, now, true);
  await setJson("slates", fresh).catch(() => undefined);
  return fresh;
}
