import { MARKET_LABELS } from "@/lib/markets";
import type { Pick } from "@/lib/picks";
import type { LeanRow } from "@/lib/insights";
import { chance, confidence, CONFIDENCE_WHY, oneIn } from "@/lib/plain";
import { Teams } from "./teams";

export type View = "simple" | "detailed";

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const lagos = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(ms);
export const naira = (x: number) => `${x >= 0 ? "+" : "−"}₦${Math.abs(Math.round(x * 1000)).toLocaleString("en-NG")}`;

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

const SOURCE: Record<Pick["source"], string> = { blend: " (blend)", guarded: " (weighted to market)" };

/** First-half legs: tonight's first-half goal chance against the fixture's usual. */
function FhMark({ p }: { p: Pick }) {
  if (!p.fh) return null;
  const d = Math.round((p.fh.now - p.fh.usual) * 100);
  if (Math.abs(d) < 2) return <span className="fhmark">1st half as usual</span>;
  const goals = d > 0;
  const good = p.market.startsWith("FH_O") === goals;
  const said = `First-half goal ${Math.round(p.fh.now * 100)}% tonight against ${Math.round(p.fh.usual * 100)}% usually for this fixture`;
  return <span className={`fhmark ${good ? "up" : "down"}`} title={said}>{goals ? "▲" : "▼"} 1st half {d > 0 ? "+" : ""}{d} vs usual<span className="sr-only"> {said}</span></span>;
}

/** Next round of a league whose last round ran hot: overs have landed a little more often. */
function HotMark({ p }: { p: Pick }) {
  if (!p.hot) return null;
  const up = p.hot.adj > 0;
  const said = `This league's last round scored ${p.hot.resid.toFixed(2)} goals a match over its prices; after rounds like that, the next round's overs have landed about 1.2% more often than priced (unders less often). Chance adjusted by ${(p.hot.adj * 100).toFixed(1)} points.`;
  return <span className={`hotmark ${up ? "up" : "down"}`} title={said}>🔥 Hot round {up ? "▲" : "▼"}<span className="sr-only"> {said}</span></span>;
}

/** What this leg gives the bookmaker per ₦1,000 over many plays: 1 − odds × its de-vigged chance. */
function CostTag({ p, worst }: { p: Pick; worst?: boolean }) {
  const cut = Math.max(0, 1 - p.odds * p.marketChance);
  return <span className={`costtag ${worst ? "worst" : ""}`} title="What this leg gives the bookmaker over many plays, from its price">
    {worst ? "Costliest: " : "Costs "}₦{Math.round(cut * 1000)} per ₦1,000</span>;
}

/** `cost`: show the leg's cost tag (slip legs); `worst` marks the slip's costliest leg. */
export function PickRow({ p, actions, now, view = "detailed", cost, worst }: { p: Pick; actions?: React.ReactNode; now?: number; view?: View; lean?: LeanRow[]; cost?: boolean; worst?: boolean }) {
  const mins = now ? Math.round((p.kickoff - now) / 60000) : null;
  const conf = confidence(p.lo, p.hi);
  if (view === "simple")
    return (
      <li className={`pick ${mins !== null && mins <= 2 ? "soon" : ""}`}>
        <div className="pick-head">
          <div className="when"><strong className="num">{lagos(p.kickoff)}</strong>{p.league}
            {mins !== null && <span className={mins <= 2 ? "loss" : ""}>{mins <= 2 ? "starting" : `in ${mins} min`}</span>}
          </div>
          <div className="match"><Teams league={p.league} home={p.home} away={p.away} /><small>{MARKET_LABELS[p.market] ?? p.market}</small></div>
          <div className="odds num" aria-label={`odds ${p.odds.toFixed(2)}`}>{p.odds.toFixed(2)}</div>
        </div>
        <p className="plain">
          <strong className="num chance">{chance(p.estimate)}</strong>
          <span>chance it lands, {oneIn(p.estimate)}</span>
        </p>
        <div className="tags">
          <span className={`badge conf-${conf.toLowerCase()}`}>{conf} confidence</span>
          <FhMark p={p} /><HotMark p={p} />{cost && <CostTag p={p} worst={worst} />}
        </div>
        {p.odds >= 5 && <p className="why longshot">Long shot: prices this big have paid back far less than they cost.</p>}
        {actions && <div className="row leg-actions">{actions}</div>}
      </li>
    );
  return (
    <li className={`pick ${mins !== null && mins <= 2 ? "soon" : ""}`}>
      <div className="pick-head">
        <div className="when"><strong className="num">{lagos(p.kickoff)}</strong>{p.league}
          {mins !== null && <span className={mins <= 2 ? "loss" : ""}>{mins <= 2 ? "starting" : `in ${mins} min`}</span>}
        </div>
        <div className="match"><Teams league={p.league} home={p.home} away={p.away} /><small>{MARKET_LABELS[p.market] ?? p.market}</small></div>
        <div className="odds num" aria-label={`odds ${p.odds.toFixed(2)}`}>{p.odds.toFixed(2)}</div>
        <span className={`badge grade-${p.grade.toLowerCase()}`}>{p.grade}</span>
      </div>
      <dl className="stats">
        <div><dt>Needs (break-even)</dt><dd>{pct(p.breakEven)}</dd></div>
        <div><dt>Market chance</dt><dd className="fair">{pct(p.marketChance)}</dd></div>
        <div><dt>History</dt><dd>{p.historyRate === null ? "None" : `${pct(p.historyRate)} of ${p.historyN.toLocaleString()}`}</dd></div>
        <div><dt>Vig estimate{SOURCE[p.source]}, 90% range</dt><dd>{pct(p.estimate)} ({pct(p.lo)} to {pct(p.hi)})</dd></div>
        <div><dt>Edge per ₦1,000</dt><dd>{naira(p.edge)}</dd></div>
      </dl>
      <Bar p={p} />
      <p className="why">{p.grade}: {p.why}.</p>
      <div className="tags"><FhMark p={p} /><HotMark p={p} />{cost && <CostTag p={p} worst={worst} />}</div>
      {p.odds >= 5 && <p className="why longshot">Long shot: in Vig&apos;s data, prices over 5 have returned far less than they cost (see Record).</p>}
      {actions && <div className="row leg-actions">{actions}</div>}
    </li>
  );
}
