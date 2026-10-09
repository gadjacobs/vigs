import { bookPicks } from "./actions";
import { CopyButton } from "./copy-button";
import { MARKET_LABELS } from "@/lib/markets";
import { loadModel, type ModelFile } from "@/lib/model";
import { buildPicks, slip, type Pick, type PickQuery } from "@/lib/picks";
import { upcoming, type Fixture } from "@/lib/sportybet";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const lagos = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);
const naira = (x: number) => `${x >= 0 ? "+" : "−"}₦${Math.abs(Math.round(x * 1000)).toLocaleString("en-NG")}`;
const LOW_CHANCE = 0.2;

function query(sp: Params): PickQuery {
  const market = one(sp.market) ?? "FH_O05";
  return {
    market: market in MARKET_LABELS ? market : "FH_O05",
    hours: Math.min(Math.max(Number(one(sp.hours) ?? 2) || 2, 0.5), 4),
    count: Math.min(Math.max(Number(one(sp.count) ?? 15) || 15, 1), 30),
    sort: one(sp.sort) === "edge" ? "edge" : "likely",
    minGrade: one(sp.grade) === "lean" ? "Lean" : "Rough",
    now: Date.now(),
  };
}

function Bar({ p }: { p: Pick }) {
  const pos = (x: number) => `${Math.min(Math.max(x, 0), 1) * 100}%`;
  return (
    <div className="bar" aria-hidden="true">
      <span className="range" style={{ left: pos(p.lo), width: `calc(${pos(p.hi)} - ${pos(p.lo)})` }} />
      <span className="est" style={{ left: pos(p.estimate) }} />
      <span className="be" style={{ left: pos(p.breakEven) }} />
    </div>
  );
}

function PickRow({ p }: { p: Pick }) {
  return (
    <li className="pick">
      <div className="pick-head">
        <div className="when"><strong className="num">{lagos(p.kickoff)}</strong>{p.league}</div>
        <div className="match">{p.home} v {p.away}<small>{MARKET_LABELS[p.market]}</small></div>
        <div className="odds num" aria-label={`odds ${p.odds.toFixed(2)}`}>{p.odds.toFixed(2)}</div>
        <span className={`badge grade-${p.grade.toLowerCase()}`}>{p.grade}</span>
      </div>
      <dl className="stats">
        <div><dt>Needs (break-even)</dt><dd>{pct(p.breakEven)}</dd></div>
        <div><dt>Market chance</dt><dd className="fair">{pct(p.marketChance)}</dd></div>
        <div><dt>History</dt><dd>{p.historyRate === null ? "None" : `${pct(p.historyRate)} of ${p.historyN.toLocaleString()}`}</dd></div>
        <div><dt>Vig estimate, 90% range</dt><dd>{pct(p.estimate)} ({pct(p.lo)} to {pct(p.hi)})</dd></div>
        <div><dt>Edge per ₦1,000</dt><dd>{naira(p.edge)}</dd></div>
      </dl>
      <Bar p={p} />
      <p className="why">{p.grade}: {p.why}. Red line is break-even; blue band is the model's 90% range.</p>
    </li>
  );
}

function CodePanel({ sp }: { sp: Params }) {
  const code = one(sp.code);
  if (!code) return null;
  const n = Number(one(sp.n)), ok = Number(one(sp.ok)), last = Number(one(sp.last));
  const ao = Number(one(sp.ao)), ae = Number(one(sp.ae)), am = Number(one(sp.am));
  return (
    <section className="receipt" aria-live="polite" aria-labelledby="code-title">
      <h2 id="code-title" style={{ margin: 0, fontSize: 18 }}>Booking code ready</h2>
      <p className="code">{code}</p>
      <p className="status">
        {n} selections. {ok === n ? "Checked: the code loads exactly these picks." : `Only ${ok} of ${n} picks loaded back; check the slip in SportyBet.`}
        {last ? ` Last match kicks off at ${lagos(last)} Lagos; each match drops off the slip once it starts.` : ""}
      </p>
      <div className="row">
        <CopyButton text={code} />
        <a className="button" href={`https://www.sportybet.com/ng/?shareCode=${code}`} target="_blank" rel="noreferrer">Open in SportyBet</a>
      </div>
      {n > 1 && (
        <p className={`note ${ae < LOW_CHANCE ? "warn" : ""}`} style={{ marginTop: 16 }}>
          As one accumulator: odds {ao.toLocaleString("en-NG", { maximumFractionDigits: 2 })}, Vig estimate {pct(ae)}, market chance {pct(am)}.
          {ae < LOW_CHANCE ? " Most slips like this lose. Singles keep each pick's own odds." : ""}
        </p>
      )}
    </section>
  );
}

export default async function Tonight({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = query(sp);
  let model: ModelFile | null = null;
  let fixtures: Fixture[] = [];
  let error = one(sp.err) ?? "";
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
  const result = model ? buildPicks(model, fixtures, q) : null;
  const qs = new URLSearchParams({
    market: q.market, hours: String(q.hours), count: String(q.count), sort: q.sort,
    grade: q.minGrade === "Lean" ? "lean" : "rough",
  }).toString();
  const legs = (result?.picks ?? []).map((p) => ({ id: p.eventId, kickoff: p.kickoff, odds: p.odds, est: p.estimate, mkt: p.marketChance }));
  const s = result ? slip(result.picks) : null;

  return (
    <main>
      <h1>Tonight</h1>
      <p className="lede">
        Upcoming vFootball matches ranked from past results. No odds history yet, so nothing is graded
        above Lean and no edge is proven.
      </p>

      <form className="panel controls" method="get" action="/">
        <label>Market
          <select name="market" defaultValue={q.market}>
            {Object.entries(MARKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Window
          <select name="hours" defaultValue={String(q.hours)}>
            {[0.5, 1, 2, 3, 4].map((h) => <option key={h} value={h}>Next {h} h</option>)}
          </select>
        </label>
        <label>Picks
          <select name="count" defaultValue={String(q.count)}>
            {[5, 10, 15, 20, 30].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
      <CodePanel sp={sp} />

      {model && (
        <p className="status">
          Model fitted on {model.fitted_on.toLocaleString()} results ({model.from.slice(0, 10)} to {model.to.slice(0, 10)}).
          Odds live from SportyBet at {lagos(q.now)} Lagos. {result?.inWindow ?? 0} matches in the window
          {result?.avoided ? `; ${result.avoided} graded Avoid and left out` : ""}.
        </p>
      )}

      {result && result.picks.length === 0 && !error && (
        <p className="note">
          Nothing in the next {q.hours} h clears the {q.minGrade} bar for {MARKET_LABELS[q.market]}.
          {q.minGrade === "Lean" ? " Show Rough picks, or widen the window." : " Widen the window, or try another market."}
        </p>
      )}

      {result && result.picks.length > 0 && (
        <>
          <form action={bookPicks} className="row" style={{ marginBottom: 16 }}>
            <input type="hidden" name="market" value={q.market} />
            <input type="hidden" name="qs" value={qs} />
            <input type="hidden" name="slip" value={JSON.stringify(legs)} />
            <button className="primary" type="submit">Get booking code for these {result.picks.length}</button>
            {s && s.model < LOW_CHANCE && result.picks.length > 1 && (
              <span className="status" style={{ margin: 0 }}>
                As one accumulator these combine to odds {s.odds.toFixed(0)} with a {pct(s.model)} Vig estimate.
              </span>
            )}
          </form>
          <ol className="picks">{result.picks.map((p) => <PickRow key={p.eventId} p={p} />)}</ol>
        </>
      )}

      <p className="status" style={{ marginTop: 24 }}>
        Personal tool, 18+. Vig never places bets or asks for SportyBet details. Picks are estimates from past
        results, not promises.
      </p>
    </main>
  );
}
