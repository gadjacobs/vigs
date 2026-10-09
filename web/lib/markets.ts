// Market keys match the Python package: 1 X 2, BY/BN, O15, FH_O05 ...
export const MARKET_LABELS: Record<string, string> = {
  FH_O05: "First half over 0.5",
  FH_O15: "First half over 1.5",
  O15: "Over 1.5",
  O25: "Over 2.5",
  U25: "Under 2.5",
  U35: "Under 3.5",
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

/** Market chance: implied probabilities with the margin removed (proportional). */
export function fairProbs(odds: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of marketGroups(Object.keys(odds))) {
    const inv = g.map((m) => 1 / odds[m]);
    const total = inv.reduce((a, b) => a + b, 0);
    g.forEach((m, i) => (out[m] = inv[i] / total));
  }
  return out;
}
