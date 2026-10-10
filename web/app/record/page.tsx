import Link from "next/link";
import { loadBlend, type BlendFile } from "@/lib/blend";
import { MARKET_LABELS } from "@/lib/markets";
import { loadInsights, type Insights } from "@/lib/insights";
import { myProfile } from "@/lib/profile";
import { loadRecord, type CodeGroup, type Group, type RecordFile } from "@/lib/record";
import { ProfitChart } from "./profit-chart";

export const dynamic = "force-dynamic";

const GRADES = ["Solid", "Lean", "Rough"];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signedPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
const naira = (x: number) => `${x < 0 ? "−" : x > 0 ? "+" : ""}₦${Math.abs(Math.round(x)).toLocaleString("en-NG")}`;
const lagos = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso));

function gate(g: string, s: Group | undefined): string {
  if (!s || s.settled === 0) return `No settled ${g} picks yet.`;
  if (s.settled < 30) return `Only ${s.settled} settled: far too few to say anything about money.`;
  return s.roi_low > 0
    ? `The 90% interval for ${g} ROI is above zero.`
    : `The 90% interval for ${g} ROI includes zero or less: no proof yet that ${g} picks make money.`;
}

function Tile({ grade, s }: { grade: string; s?: Group }) {
  return (
    <div className="tile">
      <h2><span className={`badge grade-${grade.toLowerCase()}`}>{grade}</span></h2>
      {s && s.settled > 0 ? (
        <>
          <p className={`big num ${s.roi < 0 ? "loss" : ""}`}>{signedPct(s.roi)}</p>
          <p>ROI at a flat stake{s.settled >= 30 ? `, 90% interval ${signedPct(s.roi_low)} to ${signedPct(s.roi_high)}` : ""}</p>
          <p>{s.hits} of {s.settled} landed. Vig expected {s.expected_vig.toFixed(1)}, market expected {s.expected_market.toFixed(1)}.</p>
          <p className="muted">{s.open} still to play. {naira(s.roi * 1000 * s.settled)} on ₦1,000 per pick so far.</p>
        </>
      ) : (
        <p className="muted">{grade === "Solid" ? "Nothing can be Solid until odds history validates an edge." : "No settled picks yet."}</p>
      )}
      <p className="muted" style={{ marginTop: 8 }}>{gate(grade, s)}</p>
    </div>
  );
}

function Accuracy({ blend }: { blend: BlendFile | null }) {
  if (!blend) return null;
  const rows = Object.entries(blend.markets)
    .filter(([m]) => m in MARKET_LABELS)
    .sort((a, b) => (b[1].test?.n ?? 0) - (a[1].test?.n ?? 0));
  const collecting = blend.matches < blend.min_matches;
  return (
    <section className="block" aria-labelledby="acc">
      <h2 id="acc">Accuracy</h2>
      <p className="status">
        Which estimate predicts results best on the most recent 30% of settled matches, which it did not learn from.
        Log loss: lower is better. The blend of market price and model switches on for a market only when it beats the
        results model here.
        {collecting ? ` Collecting: ${blend.matches.toLocaleString()} of ${blend.min_matches.toLocaleString()} settled matches with odds.` : ""}
      </p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Market</th><th className="n">Held-out</th><th className="n">Market</th><th className="n">Model</th>
            <th className="n">Blend</th><th>In use</th></tr></thead>
          <tbody>
            {rows.map(([m, e]) => (
              <tr key={m}>
                <td>{MARKET_LABELS[m]}</td>
                <td className="n">{e.test ? e.test.n.toLocaleString() : "None"}</td>
                <td className="n">{e.test ? e.test.market.toFixed(4) : "-"}</td>
                <td className="n">{e.test ? e.test.model.toFixed(4) : "-"}</td>
                <td className="n">{e.test ? e.test.blend.toFixed(4) : "-"}</td>
                <td title={e.reason}>{e.active ? "Blend" : "Model"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Body({ rec, user, tab, n }: { rec: RecordFile; user: string | null; tab: Tab; n: number }) {
  const mine = (user && rec.mycodes?.by_user?.[user]) || (rec.mycodes?.by_user ? null : rec.mycodes) || null;
  const series = ["Lean", "Rough"]
    .filter((g) => rec.curve[g]?.length)
    .map((g) => ({ key: g, points: rec.curve[g].map(([t, v]) => [Date.parse(t), v * 1000] as [number, number]) }));
  return (
    <>
{tab === "summary" && (<>
      <div className="tiles">{GRADES.map((g) => <Tile key={g} grade={g} s={rec.grades[g]} />)}</div>

</>)}

{tab === "yours" && (<>
      {mine && mine.codes > 0 && (
        <section className="block" aria-labelledby="mine">
          <h2 id="mine">Your codes</h2>
          <CodeTiles g={mine} />
          <p className="status">Every code {user ? `${user} booked` : "booked"} in Vig, copied to the ledger with the time it was booked. Legs that had already kicked off when booked are not scored. {mine.codes - mine.settled} code(s) still open.</p>
        </section>
      )}

      {rec.slates && rec.slates.codes > 0 && (
        <section className="block" aria-labelledby="cooked">
          <h2 id="cooked">Cooked slips</h2>
          <CodeTiles g={rec.slates} />
          {rec.slates.by_style && (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Style</th><th className="n">Settled</th><th className="n">Landed</th><th className="n">Vig expected</th><th className="n">Market expected</th><th className="n">Return per code</th></tr></thead>
                <tbody>
                  {Object.entries(rec.slates.by_style).sort((x, y) => y[1].settled - x[1].settled).map(([k, g]) => (
                    <tr key={k}>
                      <td>{k}</td><td className="n">{g.settled}</td><td className="n">{g.landed}</td>
                      <td className="n">{g.expected_vig.toFixed(1)}</td><td className="n">{g.expected_market.toFixed(1)}</td>
                      <td className={`n ${g.roi < 0 ? "loss" : ""}`}>{g.settled ? `${signedPct(g.roi)}${g.settled < 30 ? " (too few)" : ""}` : "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="status">Every slip Vig cooked and booked, logged once per code before kickoff and scored like your own.</p>
        </section>
      )}

{!(mine && mine.codes) && !(rec.slates && rec.slates.codes) && <p className="note">No booked codes in the record yet. Codes you book or open in Vig appear here once settled.</p>}
</>)}
{tab === "summary" && (<>
      {rec.ourpicks && rec.ourpicks.picks > 0 && (
        <section className="block" aria-labelledby="ours">
          <h2 id="ours">Our picks</h2>
          <div className="tile">
            {rec.ourpicks.settled ? (
              <>
                <p className="big">{(100 * rec.ourpicks.hits / rec.ourpicks.settled).toFixed(1)}%</p>
                <p>Landed {rec.ourpicks.hits} of {rec.ourpicks.settled} settled; Vig expected {(100 * rec.ourpicks.expected_vig / rec.ourpicks.settled).toFixed(1)}%,
                  the market {(100 * rec.ourpicks.expected_market / rec.ourpicks.settled).toFixed(1)}%.</p>
                <p className={rec.ourpicks.roi < 0 ? "loss" : ""}>
                  Return per single at flat stake {signedPct(rec.ourpicks.roi)}
                  {rec.ourpicks.settled >= 30 ? ` (90% interval ${signedPct(rec.ourpicks.roi_low)} to ${signedPct(rec.ourpicks.roi_high)})` : " (too few to judge)"}.
                </p>
              </>
            ) : <p>{rec.ourpicks.picks} logged, none settled yet.</p>}
            <p className="muted">Logged hourly before kickoff: each match&apos;s best-paying selection at 88% or more.</p>
          </div>
        </section>
      )}

      <section className="block" aria-labelledby="curve">
        <h2 id="curve">Profit over time</h2>
        <p className="status">Running total if ₦1,000 had gone on every settled pick, by grade, in kickoff order.</p>
        <ProfitChart series={series} />
      </section>

      </>)}
{tab === "markets" && (<>
<section className="block" aria-labelledby="markets">
        <h2 id="markets">By market</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Market</th><th>Grade</th><th className="n">Settled</th><th className="n">Landed</th>
              <th className="n">Vig expected</th><th className="n">Market expected</th><th className="n">ROI (90% interval)</th><th className="n">Open</th></tr></thead>
            <tbody>
              {rec.markets.map((m) => (
                <tr key={m.market + m.grade}>
                  <td>{MARKET_LABELS[m.market] ?? m.market}</td>
                  <td><span className={`badge grade-${m.grade.toLowerCase()}`}>{m.grade}</span></td>
                  <td className="n">{m.settled}</td><td className="n">{m.hits}</td>
                  <td className="n">{m.expected_vig.toFixed(1)}</td><td className="n">{m.expected_market.toFixed(1)}</td>
                  <td className={`n ${m.roi < 0 ? "loss" : ""}`}>
                    {!m.settled ? "None" : m.settled < 30
                      ? `${signedPct(m.roi)} (too few to judge)`
                      : `${signedPct(m.roi)} (${signedPct(m.roi_low)} to ${signedPct(m.roi_high)})`}
                  </td>
                  <td className="n">{m.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rec.confidence && Object.keys(rec.confidence).length > 0 && (
        <section className="block" aria-labelledby="conf">
          <h2 id="conf">By confidence</h2>
          <p className="status">Does High confidence land closer to its chance than Low? Rated from each pick&apos;s 90% range when it was logged.</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Confidence</th><th className="n">Settled</th><th className="n">Landed</th>
                <th className="n">Vig expected</th><th className="n">Market expected</th><th className="n">ROI (90% interval)</th></tr></thead>
              <tbody>
                {(["High", "Medium", "Low"] as const).filter((c) => rec.confidence![c]).map((c) => {
                  const g = rec.confidence![c];
                  return (
                    <tr key={c}>
                      <td><span className={`badge conf-${c.toLowerCase()}`}>{c}</span></td>
                      <td className="n">{g.settled}</td><td className="n">{g.hits}</td>
                      <td className="n">{g.expected_vig.toFixed(1)}</td><td className="n">{g.expected_market.toFixed(1)}</td>
                      <td className={`n ${g.roi < 0 ? "loss" : ""}`}>
                        {!g.settled ? "None" : g.settled < 30
                          ? `${signedPct(g.roi)} (too few to judge)`
                          : `${signedPct(g.roi)} (${signedPct(g.roi_low)} to ${signedPct(g.roi_high)})`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="block" aria-labelledby="calib">
        <h2 id="calib">Calibration</h2>
        <p className="status">When Vig said a pick had this chance, how often it landed. Close agreement means the estimates can be trusted; it does not by itself mean profit.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Vig estimate</th><th className="n">Picks</th><th className="n">Avg estimate</th><th className="n">Market chance</th><th className="n">Landed</th></tr></thead>
            <tbody>
              {rec.calibration.map((c) => (
                <tr key={c.bin}><td>{c.bin}</td><td className="n">{c.n}</td><td className="n">{pct(c.estimate)}</td>
                  <td className="n">{pct(c.market)}</td><td className="n">{pct(c.hit_rate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

</>)}
      {tab === "picks" && (
        <section className="block" aria-labelledby="recent">
          <h2 id="recent">Recent picks</h2>
          <p className="status">The latest {Math.min(n, rec.recent.length)} of {rec.recent.length} picks the collector logged, newest first.</p>
          <ol className="recentlist">
            {rec.recent.slice(0, n).map((r) => {
              const [league, , , home, away] = r.fixture.split("|");
              return (
                <li key={r.fixture + r.market + (r.generated_at ?? "")} className={r.won === false ? "is-lost" : r.won ? "is-won" : ""}>
                  <span className="num rtime">{r.kickoff ? lagos(r.kickoff) : "-"}</span>
                  <span className="rmatch">{home} v {away}<small>{MARKET_LABELS[r.market] ?? r.market} · {league}</small></span>
                  <span className="rnums"><span className="num">{r.odds.toFixed(2)}</span><small>{pct(r.estimate)} · {r.grade}</small></span>
                  <span className={`rres ${r.won === false ? "loss" : r.won ? "won" : "muted"}`}>
                    {r.won === null ? "To play" : r.won ? "✓" : "✗"}<small>{r.score ?? ""}</small>
                  </span>
                </li>
              );
            })}
          </ol>
          {n < rec.recent.length && <Link className="button" href={`/record?tab=picks&n=${n + 30}`}>Show 30 more</Link>}
        </section>
      )}

{tab === "summary" && (
      <p className="status">
        Ledger: {rec.chain.records.toLocaleString()} records, hash chain intact (head {rec.chain.head.slice(0, 12)}).
        Updated {lagos(rec.generated_at)} Lagos. Picks are logged before kickoff and never edited.
      </p>
)}
    </>
  );
}

function CodeTiles({ g }: { g: CodeGroup }) {
  return (
    <div className="tiles">
      <div className="tile">
        <h2>As booked</h2>
        <p className="big">{g.landed} of {g.settled}</p>
        <p>codes landed. Vig expected {g.expected_vig.toFixed(1)}, the market {g.expected_market.toFixed(1)}.</p>
        {g.settled > 0 && <p className={g.roi < 0 ? "loss" : ""}>Return at a flat stake per code {signedPct(g.roi)}{g.settled < 30 ? " (too few to judge)" : ""}.</p>}
      </div>
      <div className="tile">
        <h2>Leg by leg</h2>
        <p className="big">{g.legs.settled ? `${(100 * g.legs.hits / g.legs.settled).toFixed(1)}%` : "None yet"}</p>
        <p>{g.legs.hits} of {g.legs.settled} legs landed. Vig expected {g.legs.expected_vig.toFixed(1)}, the market {g.legs.expected_market.toFixed(1)}.</p>
      </div>
    </div>
  );
}

function DataSays({ ins }: { ins: Insights }) {
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const band = (lo: number, hi: number) => (hi >= 1000 ? `${lo}+` : `${lo}–${hi}`);
  const lowMargin = ins.margins[0];
  const highMargin = ins.margins[ins.margins.length - 1];
  return (
    <section className="block" aria-labelledby="says">
      <h2 id="says">What the data says</h2>
      <p className="status">
        From {ins.matches_with_odds.toLocaleString()} settled matches with captured odds and {ins.results.toLocaleString()} results,
        refreshed hourly. Figures with a ± are averages with one standard error; small samples move.
      </p>
      <h3 className="subhead">Backing every selection, by odds</h3>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Odds</th><th className="n">Selections</th><th className="n">Landed</th><th className="n">Needed to break even</th><th className="n">Return per bet</th></tr></thead>
          <tbody>
            {ins.bands.map((b) => (
              <tr key={b.lo}>
                <td>{band(b.lo, b.hi)}</td><td className="n">{b.n.toLocaleString()}</td><td className="n">{p1(b.landed)}</td>
                <td className="n">{p1(b.break_even)}</td>
                <td className={`n ${b.roi < 0 ? "loss" : ""}`}>{signedPct(b.roi)} ± {(b.se * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="status">
        Short prices lose little and long shots lose a lot: the bookmaker loads its margin onto long odds. A total built
        from several short legs keeps more value than one long shot, which is how Our picks &ldquo;Target odds&rdquo; builds.
        {lowMargin && highMargin ? ` The listed margin is lowest on ${lowMargin.family} (${p1(lowMargin.margin)}) and highest on ${highMargin.family} (${p1(highMargin.margin)}).` : ""}
      </p>
      {ins.sportybet_prob && (
        <p className="status">
          SportyBet&apos;s own published probabilities, captured since 10 October, against Vig&apos;s market chance on{" "}
          {ins.sportybet_prob.n.toLocaleString()} settled selections: log loss {ins.sportybet_prob.sportybet.toFixed(4)} against{" "}
          {ins.sportybet_prob.market.toFixed(4)} (lower is better). Vig switches to them only if they stay ahead with enough data.
        </p>
      )}
      <h3 className="subhead">Leagues</h3>
      <div className="tablewrap">
        <table>
          <thead><tr><th>League</th><th className="n">Goals</th><th className="n">Home</th><th className="n">Draw</th><th className="n">Away</th>
            <th className="n">0-0</th><th className="n">Both score</th><th className="n">First-half goals</th></tr></thead>
          <tbody>
            {ins.leagues.map((l) => (
              <tr key={l.league}>
                <td>{l.league}</td><td className="n">{l.goals.toFixed(2)}</td><td className="n">{p1(l.home)}</td><td className="n">{p1(l.draw)}</td>
                <td className="n">{p1(l.away)}</td><td className="n">{p1(l.nil_nil)}</td><td className="n">{p1(l.btts)}</td><td className="n">{p1(l.first_half_share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="status">
        The model prices each league separately, so these differences are already in every estimate. Goals split about
        evenly between the halves, unlike real football.
      </p>
    </section>
  );
}

type Tab = "summary" | "yours" | "markets" | "picks" | "data";
const TABS: [Tab, string][] = [["summary", "Summary"], ["yours", "Your codes"], ["markets", "Markets"], ["picks", "Picks"], ["data", "Data"]];

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ tab?: string; n?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = TABS.find(([t]) => t === sp.tab)?.[0] ?? "summary";
  const n = Math.min(500, Math.max(30, Number(sp.n) || 30));
  let rec: RecordFile | null = null;
  try {
    rec = await loadRecord();
  } catch {
    rec = null;
  }
  const blend = await loadBlend();
  const ins = await loadInsights();
  const { user } = await myProfile();
  return (
    <main>
      <h1>Record</h1>
      <p className="lede">
        Every pick the collector logs before kickoff, settled automatically. Shadow mode: no money is staked.
        This page is how we find out whether the picks are any good.
      </p>
      <nav className="settabs recordtabs" aria-label="Record sections">
        {TABS.map(([t, label]) => (
          <Link key={t} href={`/record?tab=${t}`} aria-current={t === tab ? "page" : undefined}>{label}</Link>
        ))}
      </nav>
      {rec && <Body rec={rec} user={user} tab={tab} n={n} />}
      {tab === "markets" && <Accuracy blend={blend} />}
      {tab === "data" && (ins ? <DataSays ins={ins} /> : <p className="note">The data summary is published hourly by the collector; it appears after its next run.</p>)}
      {!rec && (
        <p className="note warn" role="alert">
          The scorecard is not published yet. The collector writes it every hour; try again shortly.
        </p>
      )}
    </main>
  );
}
