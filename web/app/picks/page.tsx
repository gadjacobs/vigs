import { viewOf } from "@/lib/view";
import { MAX_LEGS } from "@/lib/slip";
import { cookies } from "next/headers";
import Link from "next/link";
import { lagos } from "../pick-row";
import { ScrollOnBuild } from "../scroll-on-build";
import { SlipBuilder } from "../slip-builder";
import { loadBlend } from "@/lib/blend";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel, type ModelFile } from "@/lib/model";
import { BEST_COUNTS, buildSet, COUNTS, OUR_BARS, OUR_DEFAULT, SETS, TARGETS, type SetId } from "@/lib/ourpicks";
import { candidates } from "@/lib/picks";
import { chance, oneIn } from "@/lib/plain";
import { DEFAULT_STAKE, myProfile } from "@/lib/profile";
import { DEFAULT_QUERY, type Query } from "@/lib/query";
import { upcoming, type Fixture } from "@/lib/sportybet";
import { currentSlates, type Cooked } from "@/lib/kitchen";
import { SlateCard } from "./slate-card";
import { cookSlates, RUNGS, type Slate } from "@/lib/slates";
import type { Rule } from "@/lib/likelier";

export const dynamic = "force-dynamic";

const MAX_ON_SLIP = MAX_LEGS;
type SP = { set?: string; bar?: string; odds?: string; n?: string; tab?: string; by?: string; rule?: string; pay?: string };

// Ladder controls. The default (any market, any time) shows the cooked, booked slips.
const FINISH: [string, string, number][] = [["any", "Any time", 0], ["30", "30 min", 30], ["60", "1 hour", 60], ["120", "2 hours", 120]];
const RULES: [Rule, string][] = [["any", "Any market"], ["goals", "Goals only"], ["nodraw", "No draws"]];

const ABOUT: Record<SetId, string> = {
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
  const set: SetId = SETS.find((x) => x.id === sp.set)?.id ?? "best";
  const tab = sp.tab === "build" || (sp.set && sp.tab !== "cooked") ? "build" : "cooked";
  const bar = OUR_BARS.find((b) => String(Math.round(b * 100)) === sp.bar) ?? OUR_DEFAULT;
  const target = TARGETS.find((t) => String(t) === sp.odds) ?? 10;
  const n = set === "best"
    ? BEST_COUNTS.find((c) => String(c) === sp.n) ?? 10
    : COUNTS.find((c) => String(c) === sp.n) ?? (set === "draws" ? 4 : 3);
  const link = (o: Partial<Record<keyof SP, string | number>>) =>
    `/picks?${new URLSearchParams(Object.entries({ tab: "build", set, bar: Math.round(bar * 100), odds: target, n, ...o }).map(([k, v]) => [k, String(v)]))}`;

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
  const cands = model ? candidates(model, fixtures, { ...q, now }, blend).candidates : [];
  const built = buildSet(set, cands, { bar, target, n, maxSlip: MAX_ON_SLIP });
  const all = built.slip.reduce((a, p) => a * p.estimate, 1);
  const odds = built.slip.reduce((a, p) => a * p.odds, 1);
  const last = built.slip.length ? Math.max(...built.slip.map((p) => p.kickoff)) : now;
  const matches = new Set(fixtures.filter((f) => f.kickoff > now).map((f) => f.eventId)).size;

  // The ladder: the cooked slips by default, otherwise worked out for these controls.
  const by = FINISH.some((f) => f[0] === sp.by) ? sp.by! : "any";
  const rule: Rule = RULES.some((r) => r[0] === sp.rule) ? (sp.rule as Rule) : "any";
  const payN = Number(String(sp.pay ?? "").replace(/[^0-9.]/g, ""));
  const pay = payN >= 1.3 && payN <= 100000 ? payN : null;
  const byMin = FINISH.find((f) => f[0] === by)![2];
  const usingCooked = by === "any" && rule === "any" && !pay && Boolean(cooked?.slates.length);
  const pool = cands.filter((p) => p.kickoff > now + 3 * 60_000 && (!byMin || p.kickoff <= now + byMin * 60_000));
  const ladder: Slate[] = usingCooked ? cooked!.slates : cands.length ? cookSlates(pool, rule, pay ? [pay] : RUNGS) : [];
  const ladderLink = (o: Partial<Record<"by" | "rule" | "pay", string>>) =>
    `/picks?${new URLSearchParams(Object.entries({ tab: "cooked", by, rule, pay: pay ? String(pay) : "", ...o }).filter(([, v]) => v && !(v === "any")))}`;

  return (
    <main>
      <h1>Our picks</h1>
      <nav className="pagetabs" aria-label="Our picks">
        <Link href="/picks?tab=cooked" aria-current={tab === "cooked" ? "page" : undefined}>
          Payout ladder
        </Link>
        <Link href={`/picks?tab=build&set=${set}`} aria-current={tab === "build" ? "page" : undefined}>Build your own</Link>
      </nav>
      {tab === "cooked" && (<>
      <p className="lede">The likeliest slip for each payout, from every match published now. Fewer, fairer legs: each priced 1.5 to 5, where the bookmaker keeps the least.</p>
      <form className="ladderctl" action="/picks" method="get">
        <input type="hidden" name="tab" value="cooked" />
        <div className="ctlrow">
          <span className="ctllabel">Finish by</span>
          <nav className="segmented" aria-label="Finish by">
            {FINISH.map(([v, label]) => (
              <Link key={v} role="radio" aria-checked={by === v} className="button" href={ladderLink({ by: v })}>{label}</Link>
            ))}
          </nav>
        </div>
        <div className="ctlrow">
          <span className="ctllabel">Markets</span>
          <nav className="segmented" aria-label="Markets">
            {RULES.map(([v, label]) => (
              <Link key={v} role="radio" aria-checked={rule === v} className="button" href={ladderLink({ rule: v })}>{label}</Link>
            ))}
          </nav>
        </div>
        <div className="ctlrow">
          <label className="ctllabel" htmlFor="pay">Your payout</label>
          <span className="payin">
            <input id="pay" name="pay" type="text" inputMode="decimal" placeholder="e.g. 35" defaultValue={pay ?? ""} />
            <input type="hidden" name="by" value={by} /><input type="hidden" name="rule" value={rule} />
            <button type="submit">Find</button>
            {pay ? <Link href={ladderLink({ pay: "" })} className="button">Clear</Link> : null}
          </span>
        </div>
      </form>
      {ladder.length > 0 ? (
        <>
          <p className="status">
            {usingCooked
              ? <>Cooked at {lagos(cooked!.cooked_at)} Lagos and booked, recooked with each new round.</>
              : <>Worked out now from {pool.length ? new Set(pool.map((p) => p.eventId)).size : 0} matches{byMin ? ` finishing within ${FINISH.find((f) => f[0] === by)![1].toLowerCase()}` : ""}. Book one to get its code.</>}
            {" "}Chances are SportyBet&apos;s own prices with the margin removed.
          </p>
          {ladder.length > 1 && (
            <nav className="slipjump" aria-label="Jump to a payout">
              {ladder.map((s) => (
                <a key={s.id} href={`#slip-${s.style}`}><span>{s.name}</span><b className="num">{chance(s.chance)}</b></a>
              ))}
            </nav>
          )}
          <ul className="slates">{ladder.map((s) => <SlateCard key={s.id} s={s} live={!usingCooked} />)}</ul>
        </>
      ) : (
        <p className="note">{pay ? "No slip reaches that payout from the matches in this window. Try a smaller payout or a later finish." : "Nothing published right now fits. Check back when the next round is published."}</p>
      )}
      </>)}

      {tab === "build" && (<>
      <nav className="settabs" aria-label="Pick sets">
        {SETS.map((x) => (
          <Link key={x.id} href={`/picks?tab=build&set=${x.id}`} aria-current={x.id === set ? "page" : undefined}>{x.label}</Link>
        ))}
      </nav>
      <p className="lede">{ABOUT[set]}</p>
      {set === "safe" && <Chips name="Chance bar" value={bar} options={OUR_BARS} label={(b) => `${Math.round(b * 100)}%+`} href={(b) => link({ bar: Math.round(b * 100) })} />}
      {set === "odds" && <Chips name="Total odds" value={target} options={TARGETS} label={(t) => `${t} odds`} href={(t) => link({ odds: t })} />}
      {(set === "bold" || set === "draws") && <Chips name="Legs" value={n} options={COUNTS} label={(c) => `${c} legs`} href={(c) => link({ n: c })} />}
      {set === "best" && <Chips name="Legs" value={n} options={BEST_COUNTS} label={(c) => `${c} legs`} href={(c) => link({ n: c })} />}
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
            initialIds={built.slip.map((p) => p.id)} title={SETS.find((x) => x.id === set)!.label} flex={built.flex}
            stake={profile?.prefs?.stake ?? DEFAULT_STAKE} />
        )}
      </div>
      </>)}
    </main>
  );
}
