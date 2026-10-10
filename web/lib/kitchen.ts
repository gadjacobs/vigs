import { loadBlend } from "./blend";
import { rememberEstimates, rememberPrematch } from "./codes";
import { logBooking } from "./codelog";
import { MARKET_LABELS } from "./markets";
import { loadModel } from "./model";
import { candidates } from "./picks";
import { DEFAULT_QUERY } from "./query";
import { cookSlates, type Slate } from "./slates";
import { book, selection, upcoming } from "./sportybet";
import { addTo, claim, getJson, setJson, storeReady } from "./store";

// Cooks the named slips once per newly published round, books each one, and
// keeps them in the store so every viewer (and the notifications) see the same
// slips and codes. Without a store they are cooked per server instance.

export type Cooked = { round: string; cooked_at: number; slates: Slate[] };
const FRESH = 15 * 60 * 1000;
let memory: Cooked | null = null;

async function roundKey(now: number) {
  const ids = (await upcoming()).filter((f) => f.kickoff > now).map((f) => f.eventId).sort().join(",");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function cook(round: string, now: number, bookCodes: boolean): Promise<Cooked> {
  const [model, fixtures, blend] = await Promise.all([loadModel(), upcoming(), loadBlend()]);
  const q = { ...DEFAULT_QUERY, markets: Object.keys(MARKET_LABELS), hours: 4, now };
  const slates = cookSlates(candidates(model, fixtures, q, blend).candidates);
  if (bookCodes) {
    for (const s of slates) {
      try {
        const res = await book(s.legs.map((p) => selection(p.market, p.eventId)));
        if (res.verified !== s.legs.length) continue;
        s.code = res.code;
        await rememberPrematch(res.code, Object.fromEntries(s.legs.map((p) => [p.eventId, p.odds])));
        await rememberEstimates(res.code, Object.fromEntries(s.legs.map((p) => [p.eventId, p.estimate])));
        // Same legs give the same code; log each code to the record once.
        if (Number(await addTo("slatecodes", res.code)) === 1) await logBooking(res.code, s.legs, `slate:${s.style}`, "vig");
      } catch { /* leave this slip without a code; it can still be booked from the editor */ }
    }
  }
  return { round, cooked_at: now, slates };
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
