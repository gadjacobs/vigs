// Market keys match the Python package: 1 X 2, BY/BN, O15, FH_O05 ...
export const MARKET_LABELS: Record<string, string> = {
  FH_O05: "First half over 0.5",
  FH_O15: "First half over 1.5",
  FH_O25: "First half over 2.5",
  FH_U05: "First half under 0.5",
  FH_U15: "First half under 1.5",
  FH_U25: "First half under 2.5",
  FH_O35: "First half over 3.5",
  FH_U35: "First half under 3.5",
  FH_O45: "First half over 4.5",
  FH_U45: "First half under 4.5",
  O05: "Over 0.5",
  U05: "Under 0.5 (0-0)",
  O15: "Over 1.5",
  O25: "Over 2.5",
  O35: "Over 3.5",
  O45: "Over 4.5",
  U15: "Under 1.5",
  U25: "Under 2.5",
  U35: "Under 3.5",
  U45: "Under 4.5",
  BY: "Both teams score",
  BN: "Not both teams score",
  "1": "Home win",
  X: "Draw",
  "2": "Away win",
};

const OU = /^(FH_)?([OU])(\d)(\d)$/;

export function marketGroups(markets: Iterable<string>): string[][] {
  const ms = new Set(markets);
  const groups: string[][] = [];
  if (ms.has("1") && ms.has("X") && ms.has("2")) groups.push(["1", "X", "2"]);
  if (ms.has("BY") && ms.has("BN")) groups.push(["BY", "BN"]);
  for (const mk of [...ms].sort()) {
    const m = OU.exec(mk);
    if (m && m[2] === "O") {
      const under = `${m[1] ?? ""}U${m[3]}${m[4]}`;
      if (ms.has(under)) groups.push([mk, under]);
    }
  }
  return groups;
}

/** Shin (1993), as vigs/odds.py _shin: margin loaded more heavily onto longshots. */
export function shin(inv: number[]): number[] {
  const total = inv.reduce((a, b) => a + b, 0);
  if (total <= 1) return inv.map((p) => p / total);
  const probs = (z: number) => inv.map((p) => (Math.sqrt(z * z + (4 * (1 - z) * p * p) / total) - z) / (2 * (1 - z)));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (sum(probs(mid)) > 1) lo = mid;
    else hi = mid;
  }
  const ps = probs((lo + hi) / 2);
  const s = sum(ps);
  return ps.map((p) => p / s);
}

/** Market chance: implied probabilities with the margin removed (Shin, as vigs.odds.LIVE_DEVIG). */
export function fairProbs(odds: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of marketGroups(Object.keys(odds))) {
    const ps = shin(g.map((m) => 1 / odds[m]));
    g.forEach((m, i) => (out[m] = ps[i]));
  }
  return out;
}

/** Markets grouped for the picker, with short chip labels. */
export const MARKET_GROUPS: { title: string; markets: [string, string][] }[] = [
  { title: "Goals, full time", markets: [["O05", "Over 0.5"], ["O15", "Over 1.5"], ["O25", "Over 2.5"], ["O35", "Over 3.5"], ["O45", "Over 4.5"],
    ["U05", "Under 0.5"], ["U15", "Under 1.5"], ["U25", "Under 2.5"], ["U35", "Under 3.5"], ["U45", "Under 4.5"]] },
  { title: "First half", markets: [["FH_O05", "Over 0.5"], ["FH_O15", "Over 1.5"], ["FH_O25", "Over 2.5"],
    ["FH_O35", "Over 3.5"], ["FH_O45", "Over 4.5"], ["FH_U05", "Under 0.5"], ["FH_U15", "Under 1.5"],
    ["FH_U25", "Under 2.5"], ["FH_U35", "Under 3.5"], ["FH_U45", "Under 4.5"]] },
  { title: "Both teams score", markets: [["BY", "Yes"], ["BN", "No"]] },
  { title: "Result", markets: [["1", "Home"], ["X", "Draw"], ["2", "Away"]] },
];

export const SHORT_LABELS: Record<string, string> = {
  FH_O05: "HT O0.5", FH_O15: "HT O1.5", FH_O25: "HT O2.5", FH_U05: "HT U0.5", FH_U15: "HT U1.5", FH_U25: "HT U2.5",
  FH_O35: "HT O3.5", FH_U35: "HT U3.5", FH_O45: "HT O4.5", FH_U45: "HT U4.5", O05: "O0.5", U05: "U0.5",
  O15: "O1.5", O25: "O2.5", O35: "O3.5", O45: "O4.5", U15: "U1.5", U25: "U2.5", U35: "U3.5", U45: "U4.5",
  BY: "GG", BN: "NG", "1": "Home", X: "Draw", "2": "Away",
};
