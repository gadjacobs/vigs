import { MARKET_LABELS } from "@/lib/markets";
import type { Pick } from "@/lib/picks";

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

export function PickRow({ p, actions, now }: { p: Pick; actions?: React.ReactNode; now?: number }) {
  const mins = now ? Math.round((p.kickoff - now) / 60000) : null;
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
        <div><dt>Vig estimate{p.source === "blend" ? " (blend)" : ""}, 90% range</dt><dd>{pct(p.estimate)} ({pct(p.lo)} to {pct(p.hi)})</dd></div>
        <div><dt>Edge per ₦1,000</dt><dd>{naira(p.edge)}</dd></div>
      </dl>
      <Bar p={p} />
      <p className="why">{p.grade}: {p.why}.</p>
      {actions && <div className="row leg-actions">{actions}</div>}
    </li>
  );
}
