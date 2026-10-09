"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Series = { key: string; points: [number, number][] }; // [time ms, profit in naira per 1,000 staked each]
const H = 260, M = { l: 64, r: 64, t: 16, b: 28 };
const COLOR: Record<string, string> = { Lean: "var(--series-lean)", Rough: "var(--series-rough)", Solid: "var(--ink)" };
const naira = (x: number) => `${x < 0 ? "−" : x > 0 ? "+" : ""}₦${Math.abs(Math.round(x)).toLocaleString("en-NG")}`;
const time = (ms: number, withDay: boolean) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", ...(withDay ? { day: "numeric", month: "short" } : {}),
  }).format(ms);

/** Round-number ticks whose first and last tick enclose every value. */
function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v < hi + step - 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

function valueAt(points: [number, number][], t: number): number | null {
  let v: number | null = null;
  for (const [pt, y] of points) {
    if (pt > t) break;
    v = y;
  }
  return v;
}

export function ProfitChart({ series }: { series: Series[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    // Draw at the real width so text stays 12px on phones instead of shrinking.
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const all = series.flatMap((s) => s.points);
  const times = useMemo(() => [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b), [all]);
  if (!all.length) return <p className="note">No settled picks yet. The line starts once the first logged picks finish.</p>;

  const t0 = times[0], t1 = times[times.length - 1] === t0 ? t0 + 1 : times[times.length - 1];
  const ys = all.map((p) => p[1]);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const withDay = t1 - t0 > 20 * 3600 * 1000;
  const xt = W < 480 ? [t0, t1] : [t0, t0 + (t1 - t0) / 2, t1];

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const t = t0 + (((clientX - box.left) / box.width) * W - M.l) / (W - M.l - M.r) * (t1 - t0);
    let best = 0;
    times.forEach((tt, i) => { if (Math.abs(tt - t) < Math.abs(times[best] - t)) best = i; });
    setHover(best);
  };
  const ht = hover === null ? null : times[hover];

  return (
    <div className="chart" ref={box}>
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.key}><i className="swatch" style={{ background: COLOR[s.key] }} />{s.key}</span>
        ))}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        tabIndex={0}
        aria-label={`Cumulative profit per grade at a flat ₦1,000 stake: ${series
          .map((s) => `${s.key} ${naira(s.points[s.points.length - 1]?.[1] ?? 0)}`)
          .join(", ")}. Use left and right arrows to step through settlements.`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover((h) => Math.min((h ?? -1) + 1, times.length - 1));
          if (e.key === "ArrowLeft") setHover((h) => Math.max((h ?? times.length) - 1, 0));
          if (e.key === "Escape") setHover(null);
        }}
      >
        <g className="grid">
          {ticks.map((v) => <line key={v} x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} />)}
        </g>
        <line className="zero" x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} />
        <g className="axis">
          {ticks.map((v) => <text key={v} x={M.l - 8} y={y(v) + 4} textAnchor="end">{naira(v)}</text>)}
          {xt.map((t, i) => (
            <text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"}>{time(t, withDay)}</text>
          ))}
        </g>
        {series.map((s) => {
          const d = s.points.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.key}>
              <path className="series" d={d} style={{ stroke: COLOR[s.key] }} />
              {last && <text className="label" x={x(last[0]) + 8} y={y(last[1]) + 4}>{s.key}</text>}
            </g>
          );
        })}
        {ht !== null && (
          <g>
            <line className="cross" x1={x(ht)} x2={x(ht)} y1={M.t} y2={H - M.b} />
            {series.map((s) => {
              const v = valueAt(s.points, ht);
              return v === null ? null : <circle key={s.key} className="dot" cx={x(ht)} cy={y(v)} r={5} style={{ fill: COLOR[s.key] }} />;
            })}
          </g>
        )}
      </svg>
      {ht !== null && (
        <div className="tip" style={x(ht) > W / 2 ? { left: 12 } : { right: 12 }} role="status">
          <strong>{time(ht, true)} Lagos</strong>
          {series.map((s) => {
            const v = valueAt(s.points, ht);
            return <div key={s.key}><i className="swatch" style={{ background: COLOR[s.key] }} /> {s.key}: {v === null ? "no picks yet" : naira(v)}</div>;
          })}
        </div>
      )}
    </div>
  );
}
