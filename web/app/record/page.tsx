import { loadBlend, type BlendFile } from "@/lib/blend";
import { MARKET_LABELS } from "@/lib/markets";
import { loadRecord, type Group, type RecordFile } from "@/lib/record";
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

function Body({ rec }: { rec: RecordFile }) {
  const series = ["Lean", "Rough"]
    .filter((g) => rec.curve[g]?.length)
    .map((g) => ({ key: g, points: rec.curve[g].map(([t, v]) => [Date.parse(t), v * 1000] as [number, number]) }));
  return (
    <>
      <div className="tiles">{GRADES.map((g) => <Tile key={g} grade={g} s={rec.grades[g]} />)}</div>

      <section className="block" aria-labelledby="curve">
        <h2 id="curve">Profit over time</h2>
        <p className="status">Running total if ₦1,000 had gone on every settled pick, by grade, in kickoff order.</p>
        <ProfitChart series={series} />
      </section>

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

      <section className="block" aria-labelledby="recent">
        <h2 id="recent">Recent picks</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Kickoff (Lagos)</th><th>Match</th><th>Market</th><th className="n">Odds</th>
              <th className="n">Vig estimate</th><th>Grade</th><th>Result</th></tr></thead>
            <tbody>
              {rec.recent.map((r) => {
                const [league, , , home, away] = r.fixture.split("|");
                return (
                  <tr key={r.fixture + r.market + (r.generated_at ?? "")}>
                    <td>{r.kickoff ? lagos(r.kickoff) : "-"}</td>
                    <td>{home} v {away} <span className="muted">{league}</span></td>
                    <td>{MARKET_LABELS[r.market] ?? r.market}</td>
                    <td className="n num">{r.odds.toFixed(2)}</td>
                    <td className="n">{pct(r.estimate)}</td>
                    <td><span className={`badge grade-${r.grade.toLowerCase()}`}>{r.grade}</span></td>
                    <td className={r.won === false ? "loss" : r.won ? "won" : "muted"}>
                      {r.won === null ? "To play" : `${r.won ? "Landed" : "Missed"} ${r.score ?? ""}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="status">
        Ledger: {rec.chain.records.toLocaleString()} records, hash chain intact (head {rec.chain.head.slice(0, 12)}).
        Updated {lagos(rec.generated_at)} Lagos. Picks are logged before kickoff and never edited.
      </p>
    </>
  );
}

export default async function RecordPage() {
  let rec: RecordFile | null = null;
  try {
    rec = await loadRecord();
  } catch {
    rec = null;
  }
  const blend = await loadBlend();
  return (
    <main>
      <h1>Record</h1>
      <p className="lede">
        Every pick the collector logs before kickoff, settled automatically. Shadow mode: no money is staked.
        This page is how we find out whether the picks are any good.
      </p>
      {rec && <Body rec={rec} />}
      <Accuracy blend={blend} />
      {!rec && (
        <p className="note warn" role="alert">
          The scorecard is not published yet. The collector writes it every hour; try again shortly.
        </p>
      )}
    </main>
  );
}
