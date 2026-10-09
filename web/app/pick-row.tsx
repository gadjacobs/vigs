import { MARKET_LABELS } from "@/lib/markets";
import type { Pick } from "@/lib/picks";
import { chance, confidence, CONFIDENCE_WHY, oneIn } from "@/lib/plain";

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

export function PickRow({ p, actions, now, view = "detailed" }: { p: Pick; actions?: React.ReactNode; now?: number; view?: View }) {
  const mins = now ? Math.round((p.kickoff - now) / 60000) : null;
  const conf = confidence(p.lo, p.hi);
  if (view === "simple")
    return (
      <li className={`pick ${mins !== null && mins <= 2 ? "soon" : ""}`}>
        <div className="pick-head">
          <div className="when"><strong className="num">{lagos(p.kickoff)}</strong>{p.league}
            {mins !== null && <span className={mins <= 2 ? "loss" : ""}>{mins <= 2 ? "starting" : `in ${mins} min`}</span>}
          </div>
          <div className="match">{p.home} v {p.away}<small>{MARKET_LABELS[p.market] ?? p.market}</small></div>
          <div className="odds num" aria-label={`odds ${p.odds.toFixed(2)}`}>{p.odds.toFixed(2)}</div>
          <span className={`badge conf-${conf.toLowerCase()}`}>{conf} confidence</span>
        </div>
        <p className="plain">
          <strong className="num chance">{chance(p.estimate)}</strong>
          <span>chance, {oneIn(p.estimate)}. At {p.odds.toFixed(2)} it needs {pct(p.breakEven)} to break even, so
            {p.estimate > p.breakEven ? " on our numbers it pays a little more than its chance." : " the bookmaker keeps the difference."}</span>
        </p>
        <p className="why">
          {conf} confidence: {CONFIDENCE_WHY[conf]}. Range {pct(p.lo)} to {pct(p.hi)}. Bookmaker {pct(p.marketChance)},
          history {p.historyRate === null ? "none" : `${pct(p.historyRate)} of ${p.historyN.toLocaleString()}`},
          edge {naira(p.edge)} per ₦1,000. Grade {p.grade}: {p.why}.
        </p>
        {actions && <div className="row leg-actions">{actions}</div>}
      </li>
    );
  return (
    <li className={`pick ${mins !== null && mins <= 2 ? "soon" : ""}`}>
      <div className="pick-head">
        <div className="when"><strong className="num">{lagos(p.kickoff)}</strong>{p.league}
          {mins !== null && <span className={mins <= 2 ? "loss" : ""}>{mins <= 2 ? "starting" : `in ${mins} min`}</span>}
        </div>
        <div className="match">{p.home} v {p.away}<small>{MARKET_LABELS[p.market] ?? p.market}</small></div>
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
      {actions && <div className="row leg-actions">{actions}</div>}
    </li>
  );
}
