// Independent Poisson scores, as in vigs/model.py.
const LINES = ["05", "15", "25", "35", "45"];

function pmf(lam: number, kmax = 12): number[] {
  const p = [Math.exp(-lam)];
  for (let k = 1; k <= kmax; k++) p.push((p[k - 1] * lam) / k);
  return p;
}

export function probs(lh: number, la: number, fhShare: number): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (k: string, w: number) => (out[k] = (out[k] ?? 0) + w);
  for (const [pre, s] of [["", 1], ["FH_", fhShare]] as const) {
    const ph = pmf(lh * s);
    const pa = pmf(la * s);
    ph.forEach((x, i) =>
      pa.forEach((y, j) => {
        const w = x * y;
        if (!pre) {
          add(i > j ? "1" : i === j ? "X" : "2", w);
          add(i && j ? "BY" : "BN", w);
        }
        for (const ln of LINES) add(`${pre}${i + j > Number(ln) / 10 ? "O" : "U"}${ln}`, w);
      }),
    );
  }
  return out;
}
