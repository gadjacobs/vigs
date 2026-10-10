// Independent Poisson scores, as in vigs/model.py.
const LINES = ["05", "15", "25", "35", "45"];
const TEAM_LINES = ["05", "15", "25", "35"]; // home / away team goals

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
    if (!pre) {
      // Each side's own goals: home and away team over/under.
      for (const [side, pm] of [["H_", ph], ["A_", pa]] as const) {
        const total = pm.reduce((a, b) => a + b, 0);
        for (const ln of TEAM_LINES) {
          const over = pm.reduce((a, x, k) => (k > Number(ln) / 10 ? a + x : a), 0);
          add(`${side}O${ln}`, over);
          add(`${side}U${ln}`, total - over);
        }
      }
    }
  }
  out.DC1X = out["1"] + out.X;
  out.DC12 = out["1"] + out["2"];
  out.DCX2 = out.X + out["2"];
  return out;
}
