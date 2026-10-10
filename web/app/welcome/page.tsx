import type { Metadata } from "next";
import { currentUser } from "@/lib/profile";
import { loadInsights } from "@/lib/insights";
import { loadRecord } from "@/lib/record";

export const metadata: Metadata = {
  title: "Vig: know the price before you play",
  description: "History-backed vFootball selections, cooked slips, live codes and an honest record. Personal tool, 18+.",
};

const int = (n: number) => Math.round(n).toLocaleString("en-NG");

const I = (d: string) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const FEATURES = [
  { icon: I("M4 6h16M4 12h16M4 18h10"), title: "Tonight",
    body: "Every upcoming selection with its odds, break-even, market chance and Vig's estimate with a range. Filter by market, odds, hours and confidence, save the filters you use, and build a slip in one tap." },
  { icon: I("M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"), title: "Our picks",
    body: "Named slips cooked for every round, from steady short prices to bold and draw sets, already booked. Open the code in SportyBet, or tweak it in the editor first." },
  { icon: I("M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 9h6M9 13h6"), title: "Codes, live",
    body: "Every code you book, open or track, on all your devices. While a leg plays: the minute, the score and the chance the whole code still lands, with a line of how it has swung." },
  { icon: I("M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5"), title: "Hedge",
    body: "One leg left? See the stake that covers it at SportyBet's current price, what you'd take home either way, and what covering costs on average. Book the hedge as a code if you want it." },
  { icon: I("M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0"), title: "Alerts",
    body: "A push the moment a code lands or a leg is beaten, goals that swing a code, a heads-up when one leg is left, tip slips at your times and Our picks on your schedule." },
  { icon: I("M4 19V5M4 19h16M8 15l3-4 3 2 5-6"), title: "Record",
    body: "Every pick is written to a tamper-evident ledger before kickoff and scored after, against what the bookmaker's own prices expected. Wins, losses and calibration, in the open." },
  { icon: I("M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"), title: "Share",
    body: "A clean card for any code, square or story, with captions written for WhatsApp, X and Instagram." },
  { icon: I("M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0"), title: "Your account",
    body: "Sign in with Google. Codes, filters, stake, theme and alerts follow you from phone to laptop." },
];

const STEPS = [
  { n: "01", title: "Collect", body: "Every few minutes, around the clock, Vig reads SportyBet's published odds before kickoff, the live feed while matches play, and every result." },
  { n: "02", title: "Price", body: "The bookmaker's margin is taken out to get the market's real view, then checked against a year of results. Where the two disagree, the range widens and the confidence drops." },
  { n: "03", title: "Pick and book", body: "Selections are ranked and graded, slips are cooked for each round and booked as SportyBet codes. Every pick is logged before its match starts." },
  { n: "04", title: "Follow and score", body: "Codes are tracked live and settled the moment the score decides them. Results feed the record, and the record decides what earns a better grade." },
];

/** A code as it looks in Vig: an illustration, not a real code. */
function HeroCard() {
  const pts = "0,20 12,19 22,21 30,14 42,15 52,13 60,8 72,9 84,6 100,5";
  return (
    <div className="w-card" role="img" aria-label="Illustration: a code with two legs won, one in play at 67 minutes, and a 58% chance to land, up 14 points">
      <div className="w-card-head">
        <span className="num w-code">ABC123</span>
        <span className="w-badge">In play</span>
        <span className="w-odds"><b className="num">6.12</b> odds · 4 legs</span>
      </div>
      <div className="w-legbar" aria-hidden="true"><span className="won" /><span className="won" /><span className="play" /><span /></div>
      <div className="w-chance">
        <span>Chance to land <b className="num">58%</b> <em>▲ 14</em></span>
        <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} /></svg>
      </div>
      <ol className="w-legs" aria-hidden="true">
        <li><i className="won">✓</i><span>ARS v EVE<small>Over 1.5</small></span><b className="num">2:1</b></li>
        <li><i className="won">✓</i><span>BIL v VCF<small>First half over 0.5</small></span><b className="num">1:0</b></li>
        <li><i>…</i><span>LIV v BHA<small>Home win</small></span><b className="num"><small>67&apos;</small> 1:0<small className="pct">82%</small></b></li>
        <li><i /><span>CHE v FUL<small>Under 3.5</small></span><b className="num"><small>21:16</small><small className="pct">71%</small></b></li>
      </ol>
      <p className="w-illus">Illustration</p>
    </div>
  );
}

export default async function Welcome() {
  const [user, insights, record] = await Promise.all([
    currentUser().catch(() => null),
    loadInsights().catch(() => null),
    loadRecord().catch(() => null),
  ]);
  const picks = record ? Object.values(record.grades).reduce((a, g) => a + g.picks, 0) : 0;
  const margin = insights?.margins.find((m) => m.family === "1X2")?.margin;
  const bands = insights?.bands ?? [];
  const cta = user ? { href: "/", label: "Open Vig" } : { href: "/login", label: "Sign in" };

  return (
    <main className="welcome">
      <section className="w-hero">
        <div className="w-hero-copy">
          <p className="w-kicker">vFootball on SportyBet · 18+</p>
          <h1>Know the price<br />before you play.</h1>
          <p className="w-lede">
            Vig reads every vFootball round, prices each selection from the bookmaker&apos;s odds and a year of results,
            cooks and books the slips, follows your codes live, and keeps an honest score of all of it.
          </p>
          <div className="w-cta">
            <a className="button primary" href={cta.href}>{cta.label}</a>
            <a className="button w-ghost" href="#how">How it works</a>
          </div>
        </div>
        <div className="w-hero-art"><HeroCard /></div>
      </section>

      {insights && (
        <section className="w-stats" aria-label="Vig's data, updated hourly">
          <div><b className="num">{int(insights.results)}</b><span>results on file</span></div>
          <div><b className="num">{int(insights.matches_with_odds)}</b><span>matches priced before kickoff</span></div>
          {picks > 0 && <div><b className="num">{int(picks)}</b><span>picks logged before kickoff</span></div>}
          {margin !== undefined && <div><b className="num">{(margin * 100).toFixed(1)}%</b><span>bookmaker&apos;s cut on home/draw/away</span></div>}
        </section>
      )}

      <section className="w-idea" aria-labelledby="idea">
        <div className="w-idea-copy">
          <h2 id="idea">Every price hides three numbers.</h2>
          <p>Odds of <b className="num">1.50</b> mean you need the pick to land <b>2 times in 3</b> just to break even. Take the
            bookmaker&apos;s cut out and the market itself only expects it about <b>64%</b> of the time.</p>
          <p>Vig puts those side by side with what history says, and a range for how much to trust it. A pick is only worth
            a look when it beats its break-even by more than luck explains, and when nothing does, Vig says so.</p>
        </div>
        <figure className="w-scale" aria-label="Example at odds 1.50: market chance 64%, break-even 67%">
          <div className="w-track">
            <span className="w-mark mk" style={{ left: "64%" }}><em>Market chance</em><b className="num">64%</b></span>
            <span className="w-mark be" style={{ left: "66.7%" }}><em>Break-even</em><b className="num">67%</b></span>
          </div>
          <div className="w-axis"><span>Never</span><span>Half the time</span><span>Every time</span></div>
          <figcaption>At odds 1.50 the gap between the two marks is the bookmaker&apos;s cut. A pick has to land to the right of break-even to pay.</figcaption>
        </figure>
      </section>

      <section className="w-features" aria-labelledby="features">
        <h2 id="features">Everything in one place</h2>
        <div className="w-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="w-feature">
              <span className="w-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="w-how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="w-steps">
          {STEPS.map((s) => (
            <li key={s.n}><span className="num">{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>
          ))}
        </ol>
      </section>

      {bands.length > 0 && (
        <section className="w-data" aria-labelledby="data-title">
          <h2 id="data-title">What the data says</h2>
          <p className="w-sub">What backing every selection in each odds band paid back per ₦100, across {int(bands.reduce((a, b) => a + b.n, 0))} settled selections.
            Short prices cost least; long shots cost most.{bands.every((b) => b.roi < 0) ? " Nothing pays back more than it costs." : ""}</p>
          <ul className="w-bars">
            {bands.map((b) => {
              const back = Math.max(0, 100 * (1 + b.roi));
              const label = b.hi >= 1000 ? `${b.lo}+` : `${b.lo}–${b.hi}`;
              return (
                <li key={b.lo} title={`Odds ${label}: ₦${back.toFixed(1)} back per ₦100 over ${int(b.n)} selections`}>
                  <span className="num w-band">{label}</span>
                  <span className="w-bar"><span style={{ width: `${Math.min(100, back)}%` }} /><i className="w-par" /></span>
                  <b className="num">₦{back.toFixed(0)}</b>
                </li>
              );
            })}
          </ul>
          <p className="w-note">The line at the right is ₦100, your stake back. Updated hourly from results.</p>
        </section>
      )}

      <section className="w-honest" aria-labelledby="honest">
        <h2 id="honest">Honest by design</h2>
        <ul>
          <li><b>Logged before kickoff.</b> Every pick goes into a hash-chained ledger before its match starts. Nothing is edited or deleted afterwards.</li>
          <li><b>Grades are earned.</b> The top grade needs hundreds of results, a test on matches the model never saw, a check against false discoveries and a month of data. Until something clears that bar, nothing is called better than it is.</li>
          <li><b>Never your money.</b> Vig never places bets and never asks for your SportyBet login. It books codes; you decide.</li>
          <li><b>Chances, not promises.</b> Every number is an estimate with a range. The bookmaker&apos;s cut is real, and Vig shows it on every price.</li>
        </ul>
      </section>

      <section className="w-final">
        <h2>Play with your eyes open.</h2>
        <a className="button primary" href={cta.href}>{cta.label}</a>
        <p className="w-small">Personal tool for adults 18 and over. Virtual football is a game of chance and the bookmaker keeps a margin on every bet.
          Only stake what you can afford to lose, and stop when it stops being fun.</p>
      </section>
    </main>
  );
}
