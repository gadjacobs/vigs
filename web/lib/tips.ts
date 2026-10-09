import { loadBlend } from "./blend";
import { SHORT_LABELS } from "./markets";
import { loadModel } from "./model";
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
