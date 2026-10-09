import { SlipBuilder } from "./slip-builder";
import { lagos } from "./pick-row";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel, type ModelFile } from "@/lib/model";
import { candidates } from "@/lib/picks";
import { upcoming, type Fixture } from "@/lib/sportybet";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const num = (v: string | undefined, d: number, lo: number, hi: number) => {
  const x = Number(v);
  return Number.isFinite(x) && v !== undefined && v !== "" ? Math.min(Math.max(x, lo), hi) : d;
};

function parse(sp: Params) {
  const markets = many(sp.market).filter((m) => m in MARKET_LABELS);
  return {
    markets: markets.length ? markets : ["FH_O05"],
    hours: num(one(sp.hours), 2, 0.5, 4),
    minOdds: num(one(sp.min), 1.01, 1.01, 100),
    maxOdds: num(one(sp.max), 100, 1.01, 1000),
    mode: one(sp.mode) === "target" ? ("target" as const) : ("count" as const),
    count: Math.round(num(one(sp.count), 10, 1, 30)),
    target: num(one(sp.target), 5, 1.2, 1000),
    sort: one(sp.sort) === "edge" ? ("edge" as const) : ("likely" as const),
    minGrade: one(sp.grade) === "lean" ? ("Lean" as const) : ("Rough" as const),
  };
}

export default async function Tonight({ searchParams }: { searchParams: Promise<Params> }) {
  const q = parse(await searchParams);
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
  const r = model ? candidates(model, fixtures, { ...q, now }) : null;
  const slipKey = JSON.stringify({ ...q, n: r?.candidates.length, t: Math.floor(now / 60000) });

  return (
    <main>
      <h1>Tonight</h1>
      <p className="lede">
        Upcoming vFootball selections ranked from past results. No odds history yet, so nothing is graded
        above Lean and no edge is proven.
      </p>

      <form className="panel controls" method="get" action="/">
        <fieldset className="markets">
          <legend>Markets (pick any)</legend>
          <div className="checks">
            {Object.entries(MARKET_LABELS).map(([k, v]) => (
              <label key={k}><input type="checkbox" name="market" value={k} defaultChecked={q.markets.includes(k)} />{v}</label>
            ))}
          </div>
        </fieldset>
        <label>Window
          <select name="hours" defaultValue={String(q.hours)}>
            {[0.5, 1, 2, 3, 4].map((h) => <option key={h} value={h}>Next {h} h</option>)}
          </select>
        </label>
        <label>Leg odds from
          <input type="number" name="min" step="0.01" min="1.01" defaultValue={q.minOdds === 1.01 ? "" : q.minOdds} placeholder="1.01" />
        </label>
        <label>to
          <input type="number" name="max" step="0.01" min="1.01" defaultValue={q.maxOdds === 100 ? "" : q.maxOdds} placeholder="any" />
        </label>
        <label>Build
          <select name="mode" defaultValue={q.mode}>
            <option value="count">A number of picks</option>
            <option value="target">To total odds</option>
          </select>
        </label>
        <label>Picks
          <select name="count" defaultValue={String(q.count)}>
            {[3, 5, 10, 15, 20, 30].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>Total odds
          <input type="number" name="target" step="0.5" min="1.2" list="targets" defaultValue={q.target} />
          <datalist id="targets">{[2, 3, 5, 10, 20, 50].map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label>Rank by
          <select name="sort" defaultValue={q.sort}>
            <option value="likely">Likelihood</option>
            <option value="edge">Edge</option>
          </select>
        </label>
        <label>Lowest grade
          <select name="grade" defaultValue={q.minGrade === "Lean" ? "lean" : "rough"}>
            <option value="rough">Rough</option>
            <option value="lean">Lean</option>
          </select>
        </label>
        <button type="submit">Show picks</button>
      </form>

      {error && <p className="note warn" role="alert">{error}</p>}

      {model && r && (
        <p className="status">
          Model fitted on {model.fitted_on.toLocaleString()} results ({model.from.slice(0, 10)} to {model.to.slice(0, 10)}).
          Odds live from SportyBet at {lagos(now)} Lagos. {r.matches} matches in the window, {r.candidates.length} selections
          pass your filters{r.avoided ? `; ${r.avoided} graded Avoid and left out` : ""}.
          {q.mode === "target" ? ` Building to total odds of ${q.target}: the most likely slip between ${q.target} and ${(q.target * 1.25).toFixed(2)}.` : ""}
        </p>
      )}

      {r && r.candidates.length === 0 && !error && (
        <p className="note">
          Nothing in the next {q.hours} h clears the {q.minGrade} bar with these filters.
          {q.minGrade === "Lean" ? " Show Rough picks, or widen the window." : " Widen the window, add markets, or relax the odds range."}
        </p>
      )}

      {r && r.candidates.length > 0 && (
        <SlipBuilder key={slipKey} cands={r.candidates} mode={q.mode} count={q.count} target={q.target} sort={q.sort} />
      )}

      <p className="status" style={{ marginTop: 24 }}>
        Personal tool, 18+. Vig never places bets or asks for SportyBet details. Picks are estimates from past
        results, not promises. Legs from different matches are treated as independent.
      </p>
    </main>
  );
}
