import { cookies } from "next/headers";
import Link from "next/link";
import { lagos } from "../pick-row";
import { ScrollOnBuild } from "../scroll-on-build";
import { SlipBuilder } from "../slip-builder";
import { loadBlend } from "@/lib/blend";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel, type ModelFile } from "@/lib/model";
import { buildSet, COUNTS, OUR_BARS, OUR_DEFAULT, SETS, TARGETS, type SetId } from "@/lib/ourpicks";
import { candidates } from "@/lib/picks";
import { chance, oneIn } from "@/lib/plain";
import { myProfile } from "@/lib/profile";
import { DEFAULT_QUERY, type Query } from "@/lib/query";
import { upcoming, type Fixture } from "@/lib/sportybet";
import { currentSlates, type Cooked } from "@/lib/kitchen";
import { SlateCard } from "./slate-card";

export const dynamic = "force-dynamic";

const MAX_ON_SLIP = 30;
type SP = { set?: string; bar?: string; odds?: string; n?: string };

const ABOUT: Record<SetId, string> = {
  safe: "For every published match, the best-paying selection with a chance at or above the bar.",
  odds: "The likeliest slip near your total odds, built from legs priced 1.25 to 2.2 that the market and model broadly agree on. In the settled data, prices under 2 lost 1-2% of stakes on average while prices over 5 lost 24-48%, so several short legs keep more value than one long shot.",
  bold: "Bigger odds with High confidence: legs at 1.8 or more where the bookmaker's price and the model agree closely, likeliest first.",
  draws: "The likeliest draws: evenly matched games, more often in Spain and Italy, where 28% of games are drawn against 25% in England. The table shows the chance that at least some of them land, for SportyBet's Flex option.",
};

function Chips<T extends string | number>({ name, value, options, label, href }: {
  name: string; value: T; options: readonly T[]; label: (v: T) => string; href: (v: T) => string;
}) {
  return (
    <nav className="segmented barpick" aria-label={name}>
      {options.map((v) => (
        <Link key={String(v)} role="radio" aria-checked={v === value} href={href(v)} className="button">{label(v)}</Link>
      ))}
    </nav>
  );
}

export default async function OurPicks({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  let cooked: Cooked | null = null;
  try {
    cooked = await currentSlates();
  } catch {
    cooked = null;
  }
  const set: SetId = SETS.find((x) => x.id === sp.set)?.id ?? "safe";
  const bar = OUR_BARS.find((b) => String(Math.round(b * 100)) === sp.bar) ?? OUR_DEFAULT;
  const target = TARGETS.find((t) => String(t) === sp.odds) ?? 10;
  const n = COUNTS.find((c) => String(c) === sp.n) ?? (set === "draws" ? 4 : 3);
  const link = (o: Partial<Record<keyof SP, string | number>>) =>
    `/picks?${new URLSearchParams(Object.entries({ set, bar: Math.round(bar * 100), odds: target, n, ...o }).map(([k, v]) => [k, String(v)]))}`;

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
  const built = buildSet(set, cands, { bar, target, n, maxSlip: MAX_ON_SLIP });
  const all = built.slip.reduce((a, p) => a * p.estimate, 1);
  const odds = built.slip.reduce((a, p) => a * p.odds, 1);
  const last = built.slip.length ? Math.max(...built.slip.map((p) => p.kickoff)) : now;
  const matches = new Set(fixtures.filter((f) => f.kickoff > now).map((f) => f.eventId)).size;

  return (
    <main>
      <h1>Our picks</h1>
      <p className="lede">Slips cooked for the rounds published now, named by style and already booked. Open one in SportyBet, or edit it first.</p>
      {cooked && cooked.slates.length > 0 ? (
        <>
          <p className="status">
            {cooked.slates.length} slips cooked at {lagos(cooked.cooked_at)} Lagos. Which slips appear depends on what this round offers:
            each needs enough legs at its confidence level. They are recooked when a new round is published.
          </p>
          <ul className="slates">{cooked.slates.map((s) => <SlateCard key={s.id} s={s} />)}</ul>
        </>
      ) : (
        <p className="note">Nothing published right now is good enough to cook a slip. Check back when the next round is published.</p>
      )}

      <h2 className="buildown">Build your own</h2>
      <nav className="settabs" aria-label="Pick sets">
        {SETS.map((x) => (
          <Link key={x.id} href={`/picks?set=${x.id}`} aria-current={x.id === set ? "page" : undefined}>{x.label}</Link>
        ))}
      </nav>
      <p className="lede">{ABOUT[set]}</p>
      {set === "safe" && <Chips name="Chance bar" value={bar} options={OUR_BARS} label={(b) => `${Math.round(b * 100)}%+`} href={(b) => link({ bar: Math.round(b * 100) })} />}
      {set === "odds" && <Chips name="Total odds" value={target} options={TARGETS} label={(t) => `${t} odds`} href={(t) => link({ odds: t })} />}
      {(set === "bold" || set === "draws") && <Chips name="Legs" value={n} options={COUNTS} label={(c) => `${c} legs`} href={(c) => link({ n: c })} />}
      {error && <p className="note warn" role="alert">{error}</p>}
      {model && !error && (
        <p className="status">
          {matches} matches published. {built.pool.length} selections fit this set
          {built.slip.length ? `; the slip ends by ${lagos(last)} Lagos` : ""}. Selections graded Avoid are left out.
          {set === "safe" && built.pool.length > MAX_ON_SLIP ? ` The slip starts with the ${MAX_ON_SLIP} soonest; add the rest below.` : ""}
        </p>
      )}
      {built.slip.length > 1 && (
        <p className="note">
          {built.slip.length} legs at {odds.toFixed(2)}: all land {chance(all)} of the time ({oneIn(all)}).
          {set === "safe" ? " Each pick is likely, but every extra leg multiplies the risk; short slips or singles keep more of each pick's chance." : ""}
          {set === "draws" ? " Draws are never likely on their own; Flex softens a miss but pays less." : ""}
        </p>
      )}
      {model && !built.slip.length && !error && (
        <p className="note">Nothing published right now fits this set. Try another option, or check back when the next round is published.</p>
      )}
      <div id="results" tabIndex={-1} className="results">
        <ScrollOnBuild key={now} target="results" />
        {built.pool.length > 0 && (
          <SlipBuilder key={`${now}-${set}-${bar}-${target}-${n}`} cands={built.pool} q={q} now={now} initialView={view}
            initialIds={built.slip.map((p) => p.id)} title={SETS.find((x) => x.id === set)!.label} flex={built.flex} />
        )}
      </div>
    </main>
  );
}
