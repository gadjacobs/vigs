import Link from "next/link";
import { lagos } from "../pick-row";
import { FlexRow } from "../flex-row";
import { KeepMeter } from "../keep-meter";
import { multiBonus } from "@/lib/bonus";
import { SlateActions } from "./slate-actions";
import { MARKET_LABELS } from "@/lib/markets";
import { chance, oneIn } from "@/lib/plain";
import type { Slate } from "@/lib/slates";
import { Teams } from "../teams";

export function SlateCard({ s }: { s: Slate }) {
  return (
    <li id={`slip-${s.style}`} className={`slate conf-edge-${s.confidence.toLowerCase()}`}>
      <div className="slatehead">
        <h3>{s.name}</h3>
        <span className={`badge conf-${s.confidence.toLowerCase()}`}>{s.confidence} confidence</span>
        <span className="muted slatewin">{lagos(s.first)}{s.last !== s.first ? `–${lagos(s.last)}` : ""}</span>
      </div>
      <p className="slatestats">
        <strong className="num">{s.odds.toFixed(2)}</strong> odds{(() => { const b = multiBonus(s.legs.map((p) => ({ odds: p.odds, p: p.marketChance }))); return b.ratio > 0 ? <span className="muted"> +{Math.round(b.ratio * 100)}% bonus</span> : null; })()} · {s.legs.length} legs ·{" "}
        <strong>{chance(s.chance)}</strong> chance all land <span className="muted">({oneIn(s.chance)})</span>
      </p>
      <p className="why">{s.blurb}</p>
      <details className="slatelegsbox" open={s.legs.length <= 4}>
      <summary>{s.legs.length} legs</summary>
      <ol className="slatelegs">
        {s.legs.map((p) => (
          <li key={p.id}>
            <span className="num">{lagos(p.kickoff)}</span>
            <span><Teams league={p.league} home={p.home} away={p.away} /><small>{MARKET_LABELS[p.market] ?? p.market} · {p.league}</small></span>
            <span className="num">{p.odds.toFixed(2)}</span>
            <span className="muted">{chance(p.estimate)}</span>
          </li>
        ))}
      </ol>
      </details>
      <KeepMeter legs={s.legs} />
      <FlexRow ps={s.legs.map((p) => p.estimate)} market={s.legs.map((p) => p.marketChance)} />
      {s.code ? (
        <SlateActions code={s.code} legs={s.legs.length} odds={s.odds} last={s.last} style={s.style}
          edit={<Link className="button" href={`/picks/edit?slate=${encodeURIComponent(s.id)}`}>Edit</Link>} />
      ) : (
        <Link className="button primary wide" href={`/picks/edit?slate=${encodeURIComponent(s.id)}`}>Edit and book</Link>
      )}
    </li>
  );
}
