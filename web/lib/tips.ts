import { loadBlend } from "./blend";
import { SHORT_LABELS } from "./markets";
import { loadModel } from "./model";
import { MARKET_LABELS as LABELS } from "./markets";
import { buildSet, SETS, type SetId } from "./ourpicks";
import { candidates } from "./picks";
import { chance, oneIn, slipConfidence } from "./plain";
import type { Payload } from "./push";
import { parseQuery, queryString } from "./query";
import { slipStats, toTarget, topN } from "./slip";
import { upcoming } from "./sportybet";

const lagos = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);

/** A tip notification: the slip the Tonight page would build with these filters. */
export async function buildTip(qs: string, now: number): Promise<Payload> {
  const q = parseQuery(Object.fromEntries(new URLSearchParams(qs)));
  const url = `/?${queryString(q)}`;
  const [model, fixtures, blend] = await Promise.all([loadModel(), upcoming(), loadBlend()]);
  const r = candidates(model, fixtures, { ...q, now }, blend);
  const legs = q.mode === "target" ? toTarget(r.candidates, q.target, q.tol, q.maxLegs || 30) : topN(r.candidates, q.count, q.sort);
  const markets = q.markets.map((m) => SHORT_LABELS[m] ?? m).join(", ");
  if (!legs.length)
    return { title: "Vig: nothing to book", url, tag: "tip",
      body: `Nothing in the next ${q.hours} h clears the ${q.minGrade} bar for ${markets}${q.mode === "target" ? ` at total odds ${q.target}` : ""}.` };
  const s = slipStats(legs);
  const first = Math.min(...legs.map((l) => l.kickoff));
  return {
    title: `Vig: ${legs.length} legs at ${s.odds.toFixed(2)}`,
    body: `${chance(s.model)} chance all land, ${oneIn(s.model)}. ${slipConfidence(legs)} confidence. ` +
      `First kickoff ${lagos(first)}. ${markets}. Tap to review and book.`,
    url, tag: "tip",
  };
}

/** An Our picks notification for the chosen set, priced live. */
export async function buildOurs(setId: string, now: number): Promise<Payload> {
  const set = (SETS.find((x) => x.id === setId) ?? SETS[0]);
  const url = `/picks?set=${set.id}`;
  const [model, fixtures, blend] = await Promise.all([loadModel(), upcoming(), loadBlend()]);
  const q = { ...parseQuery({}), markets: Object.keys(LABELS), hours: 4, now };
  const cands = candidates(model, fixtures, q, blend).candidates;
  const b = buildSet(set.id as SetId, cands, { bar: 0.88, target: 10, n: set.id === "draws" ? 4 : 3, maxSlip: 30 });
  if (!b.slip.length) return { title: `Vig: ${set.label}`, body: "Nothing published right now fits this set.", url, tag: "ours" };
  const s = slipStats(b.slip);
  const first = Math.min(...b.slip.map((l) => l.kickoff));
  const lead = set.id === "safe"
    ? `${b.pool.length} picks at 88%+; the 5 soonest together: ${chance(slipStats(b.slip.slice(0, 5)).model)} chance.`
    : `${b.slip.length} legs at ${s.odds.toFixed(2)}, ${chance(s.model)} chance all land (${oneIn(s.model)}).`;
  return { title: `Vig: ${set.label}`, body: `${lead} First kickoff ${lagos(first)}. Tap to review and book.`, url, tag: "ours" };
}
