import { atLeast, flexQuote } from "../lib/flex";

// SportyBet's Flex still pays (a reduced amount) when a leg or two miss. This
// shows the chance of each Flex level next to "all legs land".
// Once the legs decide a level it shows ✓ (reached) or ✗ (out of reach).
const fmt = (p: number) => (p >= 1 ? "✓" : p <= 0 ? "✗" : p >= 0.995 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

/** Misses Flex can cover for a slip of n legs: up to 2, or 3 from 10 legs. */
export const flexLevels = (n: number) => [0, 1, 2, 3].filter((m) => (m < 3 || n >= 10) && n - m >= 2);

const odds = (x: number) => (x < 100 ? x.toFixed(2) : Math.round(x).toLocaleString("en-NG"));

/** `market`: each leg's market chance, to show what SportyBet's Flex pays at each
 * level (its odds are its set payback over the chance; see lib/flex.ts). */
/** `peek`: a short word for the folded line, e.g. that a slip with a lost leg can still pay. */
export function FlexRow({ ps, note, market, peek }: { ps: number[]; note?: string; market?: number[]; peek?: string }) {
  const n = ps.length;
  if (n < 3) return null;
  const priced = market && market.length === n && market.every((p) => p > 0 && p < 1);
  const levels = flexLevels(n);
  const one = levels.find((m) => m === 1);
  return (
    // Folded by default to one line: the chance with one miss allowed. Tap for every level.
    <details className="flexrow flexfold">
      <summary>
        <span className="flexlabel">Flex</span>
        {one !== undefined ? <span className="flexpeek">{n - 1} of {n}: <b className="num">{fmt(atLeast(ps, n - 1))}</b></span> : null}
        {peek ? <span className="flexpeek muted">{peek}</span> : null}
        <span className="chev" aria-hidden="true" />
      </summary>
      <ul>
        {levels.map((m) => (
          <li key={m} className={m === 0 ? "all" : ""}>
            <span>{m === 0 ? `All ${n}` : `${n - m} of ${n}`}</span>
            <b className="num">{fmt(atLeast(ps, n - m))}</b>
            {m > 0 && priced && (() => {
              const q = flexQuote(market!, n - m);
              return q ? <small className="num flexpays" title="Flex odds as SportyBet works them out: about 0.65 over the chance">pays ≈ {odds(q.odds)}</small> : null;
            })()}
          </li>
        ))}
      </ul>
      {note && <small>{note}</small>}
    </details>
  );
}
