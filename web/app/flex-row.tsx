import { atLeast } from "../lib/flex";

// SportyBet's Flex still pays (a reduced amount) when a leg or two miss. This
// shows the chance of each Flex level next to "all legs land".
// Once the legs decide a level it shows ✓ (reached) or ✗ (out of reach).
const fmt = (p: number) => (p >= 1 ? "✓" : p <= 0 ? "✗" : p >= 0.995 ? ">99%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

/** Misses Flex can cover for a slip of n legs: up to 2, or 3 from 10 legs. */
export const flexLevels = (n: number) => [0, 1, 2, 3].filter((m) => (m < 3 || n >= 10) && n - m >= 2);

export function FlexRow({ ps, note }: { ps: number[]; note?: string }) {
  const n = ps.length;
  if (n < 3) return null;
  return (
    <div className="flexrow">
      <span className="flexlabel">With Flex</span>
      <ul>
        {flexLevels(n).map((m) => (
          <li key={m} className={m === 0 ? "all" : ""}>
            <span>{m === 0 ? `All ${n}` : `${n - m} of ${n}`}</span>
            <b className="num">{fmt(atLeast(ps, n - m))}</b>
          </li>
        ))}
      </ul>
      {note && <small>{note}</small>}
    </div>
  );
}
