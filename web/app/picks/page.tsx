import type { Pick } from "@/lib/picks";
import { viewOf } from "@/lib/view";
import { MAX_LEGS } from "@/lib/slip";
import { cookies } from "next/headers";
import Link from "next/link";
import { TabPending } from "../tab-pending";
import { lagos } from "../pick-row";
import { ScrollOnBuild } from "../scroll-on-build";
import { SlipBuilder } from "../slip-builder";
import { loadBlend } from "@/lib/blend";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel, type ModelFile } from "@/lib/model";
import { BONUS_COUNTS, BEST_COUNTS, buildSet, COUNTS, FLEX_FLOORS, FLEX_MISSES, FLEX_TARGETS, FLOOR_DEFAULT, FLOORS, OUR_BARS, OUR_DEFAULT, SETS, TARGETS, TOP_COUNTS, type SetId } from "@/lib/ourpicks";
import { applyFh } from "@/lib/fhusual";
import { FLEX_PAYBACK, flexQuote } from "@/lib/flex";
import { multiBonus } from "@/lib/bonus";
import { loadInsights } from "@/lib/insights";
import { candidates } from "@/lib/picks";
import { chance, oneIn } from "@/lib/plain";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { DEFAULT_QUERY, type Query } from "@/lib/query";
import { upcoming, type Fixture } from "@/lib/sportybet";
import { currentSlates, type Cooked } from "@/lib/kitchen";
import { SlateCard } from "./slate-card";

export const dynamic = "force-dynamic";

const MAX_ON_SLIP = MAX_LEGS;
type SP = { set?: string; bar?: string; odds?: string; n?: string; tab?: string; floor?: string; miss?: string };

const ABOUT: Record<SetId, string> = {
  top: "The likeliest selection in each match, at the price floor or above, best first. Ties lean toward markets that have landed above their price at that chance level in our data (unders, lately) and away from those below it. Edit freely; Flex shows the chance with a miss or two.",
  bonus: "A straight slip built for SportyBet's multi-bet bonus: the likeliest leg in each match priced 1.20 to 1.30, just over the bonus line (double chance left out, as it earns less bonus). Legs like these have landed slightly more often than their price, and the bonus grows faster with legs than the bookmaker's cut compounds, most of all from 30 legs, so these are the slips where the record puts the long-run return closest to, or above, the stake. Each slip still usually loses: 10 legs land about 1 in 10, 33 legs about 1 in 2,000. Check that SportyBet shows the bonus on your slip before you place it.",
  flex: "A long slip played with Flex, built to reach the Flex odds you pick: the likeliest leg per match at your lowest price, added until the odds with your misses allowed reach the target. SportyBet sets Flex odds so they return about ₦0.65 per ₦1 on vFootball whichever legs you pick (a straight slip returns about ₦0.96 per leg: ₦0.66 at 10 legs, ₦0.44 at 20), so Flex only beats a straight slip on long slips, and a higher lowest price just means fewer legs.",
  trusted: "Likely selections (60% or more) where the bookmaker's price and the model agree closely and whose market has landed at or above its price at that chance level in our data. 20 legs to start; up to 50 if that many qualify.",
  best: "One leg per match: its likeliest selection at odds of 1.2 or more, by the bookmaker's own chance, with no market filling more than 40% of the slip, so you get a spread of markets.",
  safe: "For every published match, the best-paying selection with a chance at or above the bar.",
  odds: "The likeliest slip near your total odds, built from legs priced 1.25 to 2.2 that the market and model broadly agree on. In the settled data, prices under 2 lost 1-2% of stakes on average while prices over 5 lost 24-48%, so several short legs keep more value than one long shot.",
  bold: "Bigger odds with High confidence: legs at 1.8 or more where the bookmaker's price and the model agree closely, likeliest first.",
  draws: "The likeliest draws: evenly matched games, more often in Spain and Italy, where 28% of games are drawn against 25% in England. The table shows the chance that at least some of them land, for SportyBet's Flex option.",
};

function Chips<T extends string | number>({ name, value, options, label, href }: {
  name: string; value: T; options: readonly T[]; label: (v: T) => string; href: (v: T) => string;
}) {
  return (
    <div className="chiprow">
      <span className="chiplabel">{name}</span>
      <nav className="segmented barpick" aria-label={name}>
        {options.map((v) => (
          <Link key={String(v)} role="radio" aria-checked={v === value} href={href(v)} className="button" scroll={false}>{label(v)}<TabPending /></Link>
        ))}
      </nav>
    </div>
  );
}

/** What the builder needs: the slip's legs and each match's three likeliest
 * selections (for swaps and additions), not every selection of every match. */
function lighter(pool: Pick[], slip: Pick[]): Pick[] {
  const on = new Set(slip.map((p) => p.id));
  const by = new Map<string, Pick[]>();
  for (const p of pool) (by.get(p.eventId) ?? by.set(p.eventId, []).get(p.eventId)!).push(p);
  return [...by.values()].flatMap((ps) => ps.sort((a, b) => b.estimate - a.estimate).filter((p, i) => i < 3 || on.has(p.id)));
}

export default async function OurPicks({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  let cooked: Cooked | null = null;
  try {
    cooked = await currentSlates();
  } catch {
    cooked = null;
  }
  const set: SetId = SETS.find((x) => x.id === sp.set)?.id ?? "top";
  const top = set === "top" || set === "trusted";
  const flexSet = set === "flex";
  const floor = flexSet ? FLEX_FLOORS.find((f) => String(f) === sp.floor) ?? 1.3 : FLOORS.find((f) => String(f) === sp.floor) ?? FLOOR_DEFAULT;
  const miss = FLEX_MISSES.find((m) => String(m) === sp.miss) ?? 1;
  const tab = sp.tab === "build" || (sp.set && sp.tab !== "cooked") ? "build" : "cooked";
  const bar = OUR_BARS.find((b) => String(Math.round(b * 100)) === sp.bar) ?? OUR_DEFAULT;
  const target = flexSet ? FLEX_TARGETS.find((t) => String(t) === sp.odds) ?? 100 : TARGETS.find((t) => String(t) === sp.odds) ?? 10;
  const n = set === "bonus" ? BONUS_COUNTS.find((c) => String(c) === sp.n) ?? 10
    : top ? TOP_COUNTS.find((c) => String(c) === sp.n) ?? (set === "trusted" ? 20 : 50)
    : set === "best"
    ? BEST_COUNTS.find((c) => String(c) === sp.n) ?? 10
    : COUNTS.find((c) => String(c) === sp.n) ?? (set === "draws" ? 4 : 3);
  const link = (o: Partial<Record<keyof SP, string | number>>) =>
    `/picks?${new URLSearchParams(Object.entries({ tab: "build", set, bar: Math.round(bar * 100), odds: target, n, floor, miss, ...o }).map(([k, v]) => [k, String(v)]))}`;

  const { profile } = await myProfile();
  const view = viewOf(profile, (await cookies()).get("vig_view")?.value);
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
  const q: Query = { ...DEFAULT_QUERY, markets: Object.keys(MARKET_LABELS), hours: 24, mode: "count", count: MAX_ON_SLIP, sort: "likely" };
  const insights = await loadInsights();
  const cands = model ? applyFh(candidates(model, fixtures, { ...q, now }, blend).candidates, fixtures, insights?.fh_usual, false) : [];
  const lean = insights?.lean;
  const built = buildSet(set, cands, { bar, target, n, maxSlip: MAX_ON_SLIP, floor, lean, misses: miss });
  const fq = flexSet && built.slip.length > miss + 1 ? flexQuote(built.slip.map((p) => p.marketChance), built.slip.length - miss) : null;
  const straightBack = multiBonus(built.slip.map((p) => ({ odds: p.odds, p: p.marketChance }))).payback;
  const all = built.slip.reduce((a, p) => a * p.estimate, 1);
  const odds = built.slip.reduce((a, p) => a * p.odds, 1);
  const last = built.slip.length ? Math.max(...built.slip.map((p) => p.kickoff)) : now;
  const matches = new Set(fixtures.filter((f) => f.kickoff > now).map((f) => f.eventId)).size;

  return (
    <main>
      <h1>Our picks</h1>
      <nav className="pagetabs" aria-label="Our picks">
        <Link href="/picks?tab=cooked" aria-current={tab === "cooked" ? "page" : undefined}>
          Cooked slips {cooked?.slates.length ? <span className="count">{cooked.slates.length}</span> : null}<TabPending />
        </Link>
        <Link href={`/picks?tab=build&set=${set}`} aria-current={tab === "build" ? "page" : undefined}>Build your own<TabPending /></Link>
      </nav>
      {tab === "cooked" && (<>
      <p className="lede">Slips cooked for the rounds published now, named by style and already booked. Open one in SportyBet, or edit it first.</p>
      {cooked && cooked.slates.length > 0 ? (
        <>
          <p className="status">
            {cooked.slates.length} slips cooked at {lagos(cooked.cooked_at)} Lagos. Which slips appear depends on what this round offers:
            each needs enough legs at its confidence level. They are recooked when a new round is published.
          </p>
          <nav className="slipjump" aria-label="Jump to a slip">
            {cooked.slates.map((s) => (
              <a key={s.id} href={`#slip-${s.style}`}><span>{s.name}</span><b className="num">{s.odds < 100 ? s.odds.toFixed(2) : Math.round(s.odds).toLocaleString("en-NG")}</b></a>
            ))}
          </nav>
          <ul className="slates">{cooked.slates.map((s) => <SlateCard key={s.id} s={s} />)}</ul>
        </>
      ) : (
        <p className="note">Nothing published right now is good enough to cook a slip. Check back when the next round is published.</p>
      )}
      </>)}

      {tab === "build" && (<>
      <nav className="settabs" aria-label="Pick sets">
        {SETS.map((x) => (
          <Link key={x.id} href={`/picks?tab=build&set=${x.id}`} aria-current={x.id === set ? "page" : undefined}>{x.label}<TabPending /></Link>
        ))}
      </nav>
      <p className="lede">{ABOUT[set]}</p>
      {set === "safe" && <Chips name="Chance bar" value={bar} options={OUR_BARS} label={(b) => `${Math.round(b * 100)}%+`} href={(b) => link({ bar: Math.round(b * 100) })} />}
      {set === "odds" && <Chips name="Total odds" value={target} options={TARGETS} label={(t) => String(t)} href={(t) => link({ odds: t })} />}
      {(set === "bold" || set === "draws") && <Chips name="Legs" value={n} options={COUNTS} label={(c) => String(c)} href={(c) => link({ n: c })} />}
      {set === "best" && <Chips name="Legs" value={n} options={BEST_COUNTS} label={(c) => String(c)} href={(c) => link({ n: c })} />}
      {set === "bonus" && <Chips name="Legs" value={n} options={BONUS_COUNTS} label={(c) => String(c)} href={(c) => link({ n: c })} />}
      {flexSet && <Chips name="Flex odds" value={target} options={FLEX_TARGETS} label={(t) => t.toLocaleString("en-NG")} href={(t) => link({ odds: t })} />}
      {flexSet && <Chips name="Misses allowed" value={miss} options={FLEX_MISSES} label={(m) => String(m)} href={(m) => link({ miss: m })} />}
      {flexSet && <Chips name="Lowest price" value={floor} options={FLEX_FLOORS} label={(f) => `${f.toFixed(2)}+`} href={(f) => link({ floor: f })} />}
      {top && <Chips name="Legs" value={n} options={TOP_COUNTS} label={(c) => String(c)} href={(c) => link({ n: c })} />}
      {top && <Chips name="Lowest price" value={floor} options={FLOORS} label={(f) => `${f.toFixed(2)}+`} href={(f) => link({ floor: f })} />}
      {top && <p className="hint"><Link href={`/alerts?watch=template:${set}&legs=${n}#slips`}>Notify me</Link> when {n} legs qualify for this set.</p>}
      {error && <p className="note warn" role="alert">{error}</p>}
      {model && !error && (
        <p className="status">
          {matches} matches published. {built.pool.length} selections fit this set
          {built.slip.length ? `; the slip ends by ${lagos(last)} Lagos` : ""}. Selections graded Avoid are left out.
          {set === "safe" && built.pool.length > MAX_ON_SLIP ? ` The slip starts with the ${MAX_ON_SLIP} soonest; add the rest below.` : ""}
        </p>
      )}
      {set === "bonus" && built.slip.length > 1 && (() => {
        const b = multiBonus(built.slip.map((p) => ({ odds: p.odds, p: p.marketChance })));
        const hit = built.slip.reduce((a, p) => a * p.marketChance, 1);
        const bl = insights?.bonus_legs;
        // The bonus is fixed by SportyBet's prices; only the chance each leg lands moves with k.
        const at = (k: number) => b.totalOdds * built.slip.reduce((a, p) => a * Math.min(0.999, p.marketChance * k), 1);
        return (
          <p className="note">
            {built.slip.length} legs pay <strong className="num">{Math.round(b.totalOdds).toLocaleString("en-NG")}</strong> times the stake with SportyBet&apos;s bonus of +{Math.round(b.ratio * 100)}%,
            and land {oneIn(hit)} by the market&apos;s chances, which put the long-run return at ₦{b.payback.toFixed(2)} per ₦1.
            {bl && bl.n >= 1000 ? <> Legs like these have landed {((bl.k - 1) * 100).toFixed(1)}% more often than priced ({bl.n.toLocaleString("en-NG")} legs), which puts it at about <strong className="num">₦{at(bl.k).toFixed(2)}</strong> (90% range ₦{at(bl.k_lo).toFixed(2)} to ₦{at(bl.k_hi).toFixed(2)}).</> : null}
            {built.slip.length < n ? ` Only ${built.slip.length} matches have a leg in range right now.` : ""}
          </p>
        );
      })()}
      {fq && (
        <p className="note">
          {built.slip.length} legs, Flex with {miss} miss{miss > 1 ? "es" : ""} allowed: pays about <strong className="num">{Math.round(fq.odds).toLocaleString("en-NG")}</strong> odds when {built.slip.length - miss} or more land, {chance(fq.chance)} of the time ({oneIn(fq.chance)}).
          {fq.odds < target ? ` Even ${built.slip.length} legs don't reach ${target.toLocaleString("en-NG")}: raise the lowest price or allow fewer misses.` : ""}
          {" "}In the long run Flex returns about ₦{FLEX_PAYBACK.toFixed(2)} per ₦1; the same legs straight, with SportyBet&apos;s multi-bet bonus, would return about ₦{straightBack.toFixed(2)}.
        </p>
      )}
      {built.slip.length > 1 && !flexSet && (
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
          <SlipBuilder key={`${now}-${set}-${bar}-${target}-${n}`} cands={lighter(built.pool, built.slip)} q={q} now={now} initialView={view}
            initialIds={built.slip.map((p) => p.id)} title={SETS.find((x) => x.id === set)!.label} flex={built.flex}
            stake={profile?.prefs?.stake ?? DEFAULT_STAKE} lean={lean} />
        )}
      </div>
      </>)}
    </main>
  );
}
