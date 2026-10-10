import { cookies } from "next/headers";
import { Filters } from "./filters";
import { ScrollOnBuild } from "./scroll-on-build";
import { lagos } from "./pick-row";
import { SlipBuilder } from "./slip-builder";
import { loadBlend } from "@/lib/blend";
import { myProfile } from "@/lib/profile";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel, type ModelFile } from "@/lib/model";
import { candidates } from "@/lib/picks";
import { parseQuery } from "@/lib/query";
import { upcoming, type Fixture } from "@/lib/sportybet";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export default async function Tonight({ searchParams }: { searchParams: Promise<Params> }) {
  let sp = await searchParams;
  const jar = await cookies();
  const { user, profile } = await myProfile();
  const view = (profile?.view ?? jar.get("vig_view")?.value) === "simple" ? "simple" : "detailed";
  // No filters in the URL: reuse the account's last ones, else this device's.
  if (!Object.keys(sp).length) {
    const saved = profile?.query ?? decodeURIComponent(jar.get("vig_q")?.value ?? "");
    if (saved) sp = Object.fromEntries(new URLSearchParams(saved));
  }
  const q = parseQuery(sp);
  const now = Date.now();
  let model: ModelFile | null = null;
  let fixtures: Fixture[] = [];
  let error = "";
  try {
    model = await loadModel();
  } catch {
    error = "The model file is not published yet. The collector writes it every hour; try again shortly.";
  }
  try {
    fixtures = await upcoming();
  } catch {
    error = error || "SportyBet did not answer. Try again in a minute.";
  }
  const blend = await loadBlend();
  const r = model ? candidates(model, fixtures, { ...q, now }, blend) : null;
  const blended = q.markets.filter((m) => blend?.markets[m]?.active).map((m) => MARKET_LABELS[m]);

  return (
    <main>
      <h1>Tonight</h1>
      <p className="lede">
        Upcoming vFootball selections ranked from past results. Nothing is graded above Lean until the record proves an edge.
      </p>

      <Filters initial={q} />

      <div id="results" tabIndex={-1} className="results" aria-label="Your slip and selections">
      <ScrollOnBuild key={now} target="results" />
      {error && <p className="note warn" role="alert">{error}</p>}

      {r && r.candidates.length === 0 && !error && (
        <p className="note">
          Nothing in the next {q.hours} h clears the {q.minGrade} bar with these filters.
          {q.minConf !== "Low" || q.minChance > 0
            ? ` Nothing reaches ${[q.minConf !== "Low" && `${q.minConf === "High" ? "High" : "Medium or better"} confidence`, q.minChance > 0 && `a ${Math.round(q.minChance * 100)}% chance`].filter(Boolean).join(" and ")}. Relax those filters, widen the window, or add markets.`
            : q.minGrade === "Lean" ? " Show Rough picks, or widen the window." : " Widen the window, add markets, or relax the leg odds range."}
        </p>
      )}

      {r && r.candidates.length > 0 && (
        <SlipBuilder key={now} cands={r.candidates} q={q} now={now} initialView={view} />
      )}

      {model && r && (
        <p className="status" style={{ marginTop: 16 }}>
          {r.matches} matches in the next {q.hours} h, {r.candidates.length} selections pass your filters
          {r.avoided ? `, ${r.avoided} graded Avoid and left out` : ""}. Odds live from SportyBet at {lagos(now)} Lagos;
          model fitted on {model.fitted_on.toLocaleString()} results.
          {blended.length
            ? ` Blend of market price and model in use for ${blended.join(", ")}.`
            : ` Estimates are weighted 85/15 toward the market price, which has beaten the results model so far${blend ? `; the blend switches on once proven (${blend.matches.toLocaleString()} of ${blend.min_matches.toLocaleString()} settled matches)` : ""}.`}
        </p>
      )}
      </div>

      <p className="status" style={{ marginTop: 24 }}>
        {profile && <>Signed in as <strong>{user}</strong>; codes, filters, view and theme sync across your devices. </>}
        Personal tool, 18+. Vig never places bets or asks for SportyBet details. Picks are estimates from past
        results, not promises. Legs from different matches are treated as independent.
      </p>
    </main>
  );
}
