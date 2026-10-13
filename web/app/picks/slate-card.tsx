import Link from "next/link";
import { lagos, pct } from "../pick-row";
import { BookSlate, SlateActions } from "./slate-actions";
import { MARKET_LABELS } from "@/lib/markets";
import { chance, oneIn } from "@/lib/plain";
import type { Slate } from "@/lib/slates";

export function SlateCard({ s, live = false }: { s: Slate; live?: boolean }) {
  return (
    <li id={`slip-${s.style}`} className={`slate conf-edge-${s.confidence.toLowerCase()}`}>
      <div className="slatehead">
        <h3>{s.name}</h3>
        <span className={`badge conf-${s.confidence.toLowerCase()}`}>{s.confidence} confidence</span>
        <span className="muted slatewin">{lagos(s.first)}{s.last !== s.first ? `–${lagos(s.last)}` : ""}</span>
      </div>
      <p className="slatestats">
        <strong className="num">{s.odds.toFixed(2)}</strong> odds · {s.legs.length} {s.legs.length === 1 ? "leg" : "legs"} ·{" "}
        <strong>{chance(s.chance)}</strong> chance all land <span className="muted">({oneIn(s.chance)})</span>
      </p>
      <p className="why">{s.blurb}</p>
      {(s.vsShort || s.keeps) && (
        <p className="slatevs">
          {s.vsShort && s.vsShort > 1.05 ? <><strong>{s.vsShort.toFixed(1)}× as likely</strong> as the same odds from short legs. </> : null}
          {s.keeps ? <span className="muted">Pays back {Math.round(s.keeps * 100)}% of the stake on average.</span> : null}
        </p>
      )}
      <details className="slatelegsbox" open={s.legs.length <= 4}>
      <summary>{s.legs.length === 1 ? "1 leg" : `${s.legs.length} legs`}</summary>
      <ol className="slatelegs">
        {s.legs.map((p) => (
          <li key={p.id}>
            <span className="num">{lagos(p.kickoff)}</span>
            <span>{p.home} v {p.away}<small>{MARKET_LABELS[p.market] ?? p.market} · {p.league}</small></span>
            <span className="num">{p.odds.toFixed(2)}</span>
            <span className="muted">{chance(s.target ? p.marketChance : p.estimate)}</span>
          </li>
        ))}
      </ol>
      </details>
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
        ) : live ? (
          <BookSlate style={s.style} legs={s.legs.map((p) => ({
            eventId: p.eventId, market: p.market, kickoff: p.kickoff, odds: p.odds, estimate: p.estimate,
            marketChance: p.marketChance, lo: p.lo, hi: p.hi, home: p.home, away: p.away, league: p.league,
          }))} />
        ) : null}
        <Link className="button" href={live ? `/picks/edit?legs=${encodeURIComponent(s.legs.map((p) => p.id).join(","))}&name=${encodeURIComponent(s.name)}`
          : `/picks/edit?slate=${encodeURIComponent(s.id)}`}>{s.code || live ? "Edit" : "Edit and book"}</Link>
      </div>
    </li>
  );
}
