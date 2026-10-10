import { describe, expect, it } from "vitest";
import type { Pick } from "../lib/picks";
import { smartSwitch, toTarget, topN } from "../lib/slip";

let seq = 0;
function pick(eventId: string, market: string, odds: number, estimate: number): Pick {
  seq++;
  return {
    id: `${eventId}|${market}`, eventId, league: "England", home: `H${seq}`, away: `A${seq}`, kickoff: 0,
    market, odds, breakEven: 1 / odds, marketChance: 0.9 / odds, estimate, lo: estimate - 0.02,
    hi: estimate + 0.02, historyRate: null, historyN: 0, edge: estimate * odds - 1, grade: "Rough", why: "", source: "guarded",
  };
}

const cands = [
  pick("e1", "O15", 1.3, 0.8), pick("e1", "BY", 1.9, 0.55),
  pick("e2", "O15", 1.25, 0.82), pick("e3", "O15", 1.5, 0.7),
  pick("e4", "FH_O05", 1.4, 0.75), pick("e5", "O25", 2.0, 0.52),
  pick("e6", "O15", 1.2, 0.85), pick("e7", "BY", 1.8, 0.6),
];

function brute(target: number, slack: number, low = target) {
  let best: { p: number; legs: Pick[] } | null = null;
  const byEvent = [...new Set(cands.map((c) => c.eventId))].map((e) => cands.filter((c) => c.eventId === e));
  const walk = (i: number, legs: Pick[]) => {
    if (i === byEvent.length) {
      const o = legs.reduce((a, l) => a * l.odds, 1);
      const p = legs.reduce((a, l) => a * l.estimate, 1);
      if (legs.length && o >= low && o <= target * (1 + slack) && (!best || p > best.p)) best = { p, legs: [...legs] };
      return;
    }
    walk(i + 1, legs);
    for (const c of byEvent[i]) walk(i + 1, [...legs, c]);
  };
  walk(0, []);
  return best as { p: number; legs: Pick[] } | null;
}

describe("slip building", () => {
  it("topN keeps one selection per match", () => {
    const s = topN(cands, 10, "likely");
    expect(new Set(s.map((p) => p.eventId)).size).toBe(s.length);
    expect(s[0].estimate).toBeGreaterThanOrEqual(s[s.length - 1].estimate);
  });

  it("toTarget lands within target ± tolerance and matches brute force", () => {
    for (const [target, tol] of [[2, 0.1], [3, 0.1], [5, 0.1], [10, 0.2], [20.2, 0.1]] as const) {
      const s = toTarget(cands, target, tol);
      // grid rounding: compare against brute force on a slightly inner band
      const b = brute(target * (1 - tol) * 1.01, (target * (1 + tol) * 0.99) / (target * (1 - tol) * 1.01) - 1, target * (1 - tol) * 1.01);
      if (!s.length) { expect(b).toBeNull(); continue; }
      const odds = s.reduce((a, l) => a * l.odds, 1);
      const p = s.reduce((a, l) => a * l.estimate, 1);
      expect(odds).toBeGreaterThanOrEqual(target * (1 - tol) * 0.985);
      expect(odds).toBeLessThanOrEqual(target * (1 + tol) * 1.015);
      expect(new Set(s.map((l) => l.eventId)).size).toBe(s.length);
      if (b) expect(p).toBeGreaterThanOrEqual(b.p - 1e-9);
    }
  });

  it("respects the maximum number of legs", () => {
    const s = toTarget(cands, 5, 0.1, 2);
    expect(s.length).toBeLessThanOrEqual(2);
  });

  it("returns an empty slip when the target cannot be reached", () => {
    expect(toTarget(cands.slice(0, 2), 1000)).toEqual([]);
  });

  it("smart switch keeps the price close and avoids matches already used", () => {
    const s = [cands[0], cands[2], cands[3]];
    const alt = smartSwitch(s, cands, cands[3].id)!;
    expect(alt).toBeTruthy();
    expect(["e2", "e1"]).not.toContain(alt.eventId);
    expect(Math.abs(Math.log(alt.odds / 1.5))).toBeLessThanOrEqual(Math.log(1.15) + 1e-9);
  });
});

import { ourPicks } from "../lib/ourpicks";

describe("our picks", () => {
  it("takes the best-paying selection at or above the bar, one per match", () => {
    const p = (eventId: string, market: string, odds: number, estimate: number, kickoff = 1) =>
      ({ id: `${eventId}|${market}`, eventId, market, odds, estimate, kickoff }) as never;
    const out = ourPicks([p("a", "FH_U35", 1.04, 0.96), p("a", "U45", 1.12, 0.9), p("a", "O15", 1.3, 0.77),
      p("b", "O05", 1.08, 0.91, 0), p("c", "U45", 1.2, 0.85)], 0.88);
    expect(out.map((x: { id: string }) => x.id)).toEqual(["b|O05", "a|U45"]);
  });
});

import { atLeast, landedDist } from "../lib/flex";

describe("flex", () => {
  it("adds up and matches the binomial", () => {
    const d = landedDist([0.3, 0.3, 0.3]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(d[3]).toBeCloseTo(0.027, 12);
    expect(atLeast([0.3, 0.3, 0.3], 2)).toBeCloseTo(0.216, 12);
    expect(atLeast([0.5], 0)).toBe(1);
  });
});

import { buildSet } from "../lib/ourpicks";

describe("our picks sets", () => {
  const p = (eventId: string, market: string, odds: number, estimate: number, lo = estimate - 0.01, hi = estimate + 0.01) =>
    ({ id: `${eventId}|${market}`, eventId, market, odds, estimate, lo, hi, kickoff: 1 }) as never;
  const cands = [p("a", "X", 3.4, 0.29), p("b", "X", 3.6, 0.27), p("c", "X", 3.2, 0.3), p("a", "O15", 1.5, 0.66),
    p("b", "O15", 1.9, 0.52), p("c", "BY", 2.0, 0.48, 0.4, 0.55), p("d", "1", 1.6, 0.62), p("e", "2", 1.7, 0.58)];
  const o = { bar: 0.88, target: 5, n: 2, maxSlip: 30 };
  it("draws: likeliest first", () => {
    expect(buildSet("draws", cands, o).slip.map((x: { eventId: string }) => x.eventId)).toEqual(["c", "a"]);
  });
  it("bold: High confidence only", () => {
    expect(buildSet("bold", cands, o).pool.map((x: { id: string }) => x.id)).toEqual(["b|O15"]);
  });
  it("odds: short legs near the target", () => {
    const s = buildSet("odds", cands, o).slip as unknown as { odds: number }[];
    const total = s.reduce((a, x) => a * x.odds, 1);
    expect(total).toBeGreaterThanOrEqual(4.5);
    expect(total).toBeLessThanOrEqual(5.5);
    expect(s.every((x) => x.odds <= 2.2)).toBe(true);
  });
});
