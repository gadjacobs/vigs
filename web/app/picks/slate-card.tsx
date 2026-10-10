import Link from "next/link";
import { lagos, pct } from "../pick-row";
import { SlateActions } from "./slate-actions";
import { MARKET_LABELS } from "@/lib/markets";
import { chance, oneIn } from "@/lib/plain";
import type { Slate } from "@/lib/slates";

export function SlateCard({ s }: { s: Slate }) {
  return (
    <li className={`slate conf-edge-${s.confidence.toLowerCase()}`}>
      <div className="slatehead">
        <h3>{s.name}</h3>
        <span className={`badge conf-${s.confidence.toLowerCase()}`}>{s.confidence} confidence</span>
        <span className="muted slatewin">{lagos(s.first)}{s.last !== s.first ? `–${lagos(s.last)}` : ""}</span>
      </div>
      <p className="slatestats">
        <strong className="num">{s.odds.toFixed(2)}</strong> odds · {s.legs.length} legs ·{" "}
        <strong>{chance(s.chance)}</strong> chance all land <span className="muted">({oneIn(s.chance)})</span>
      </p>
      <p className="why">{s.blurb}</p>
      <ol className="slatelegs">
        {s.legs.map((p) => (
          <li key={p.id}>
            <span className="num">{lagos(p.kickoff)}</span>
            <span>{p.home} v {p.away}<small>{MARKET_LABELS[p.market] ?? p.market} · {p.league}</small></span>
            <span className="num">{p.odds.toFixed(2)}</span>
            <span className="muted">{chance(p.estimate)}</span>
          </li>
        ))}
      </ol>
      {s.flex && (
        <table className="flextable">
          <caption>With Flex on in SportyBet, the slip pays a reduced amount when legs miss.</caption>
          <tbody>
            {s.flex.map((f) => (
              <tr key={f.need}><td>{f.need === s.legs.length ? `All ${f.need}` : `At least ${f.need} of ${s.legs.length}`}</td><td className="n">{pct(f.chance)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row slateactions">
        {s.code ? (
          <SlateActions code={s.code} legs={s.legs.length} odds={s.odds} last={s.last} style={s.style} />
        ) : null}
        <Link className="button" href={`/picks/edit?slate=${encodeURIComponent(s.id)}`}>{s.code ? "Edit" : "Edit and book"}</Link>
      </div>
    </li>
  );
}
