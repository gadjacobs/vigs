import { cookies } from "next/headers";
import { lagos } from "../pick-row";
import { ScrollOnBuild } from "../scroll-on-build";
import { SlipBuilder } from "../slip-builder";
import { loadBlend } from "@/lib/blend";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel, type ModelFile } from "@/lib/model";
import { OUR_BARS, OUR_DEFAULT, ourPicks } from "@/lib/ourpicks";
import { candidates } from "@/lib/picks";
import { chance, oneIn } from "@/lib/plain";
import { myProfile } from "@/lib/profile";
import { DEFAULT_QUERY, type Query } from "@/lib/query";
import { upcoming, type Fixture } from "@/lib/sportybet";

export const dynamic = "force-dynamic";

const MAX_ON_SLIP = 30;

export default async function OurPicks({ searchParams }: { searchParams: Promise<{ bar?: string }> }) {
  const { bar: barParam } = await searchParams;
  const bar = OUR_BARS.find((b) => String(Math.round(b * 100)) === barParam) ?? OUR_DEFAULT;
  const { profile } = await myProfile();
  const view = (profile?.view ?? (await cookies()).get("vig_view")?.value) === "detailed" ? "detailed" : "simple";
  const now = Date.now();
  let model: ModelFile | null = null;
  let fixtures: Fixture[] = [];
  let error = "";
  try {
    model = await loadModel();
    fixtures = await upcoming();
  } catch {
    error = "SportyBet or the model file did not answer. Try again in a minute.";
  }
  const blend = await loadBlend();
  const q: Query = { ...DEFAULT_QUERY, markets: Object.keys(MARKET_LABELS), hours: 4, mode: "count", count: MAX_ON_SLIP, sort: "likely" };
  const cands = model ? candidates(model, fixtures, { ...q, now }, blend).candidates : [];
  const picks = ourPicks(cands, bar);
  const onSlip = picks.slice(0, MAX_ON_SLIP);
  const all = onSlip.reduce((a, p) => a * p.estimate, 1);
  const last = picks.length ? Math.max(...picks.map((p) => p.kickoff)) : now;
  const matches = new Set(fixtures.filter((f) => f.kickoff > now).map((f) => f.eventId)).size;

  return (
    <main>
      <h1>Our picks</h1>
      <p className="lede">
        For every published match, the best-paying selection that still has a chance of {Math.round(bar * 100)}% or more. Edit the
        slip or book it as it is.
      </p>
      <nav className="segmented barpick" aria-label="Chance bar">
        {OUR_BARS.map((b) => (
          <a key={b} role="radio" aria-checked={b === bar} href={`/picks?bar=${Math.round(b * 100)}`} className="button">
            {Math.round(b * 100)}%+
          </a>
        ))}
      </nav>
      {error && <p className="note warn" role="alert">{error}</p>}
      {model && (
        <p className="status">
          {picks.length} of {matches} published matches have a selection at {Math.round(bar * 100)}% or more, kicking off
          by {lagos(last)} Lagos. Selections graded Avoid are left out.
          {picks.length > MAX_ON_SLIP ? ` The slip starts with the ${MAX_ON_SLIP} soonest; add the rest below.` : ""}
        </p>
      )}
      {onSlip.length > 1 && (
        <p className="note">
          Each pick lands at least {Math.round(bar * 100)}% of the time on Vig's estimate, but all {onSlip.length} together land {chance(all)} of the time ({oneIn(all)}).
          Every extra leg multiplies the risk; short slips or singles keep more of each pick&apos;s chance.
        </p>
      )}
      {model && !picks.length && !error && (
        <p className="note">Nothing published right now clears the {Math.round(bar * 100)}% bar. Try a lower bar, or check back when the next round is published.</p>
      )}
      <div id="results" tabIndex={-1} className="results">
        <ScrollOnBuild key={now} target="results" />
        {picks.length > 0 && (
          <SlipBuilder key={`${now}-${bar}`} cands={picks} q={q} now={now} initialView={view}
            initialIds={onSlip.map((p) => p.id)} title="Our picks slip" />
        )}
      </div>
    </main>
  );
}
