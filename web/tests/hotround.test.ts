import { describe, expect, it } from "vitest";
import { applyHot, expectedGoals, hotAdj, hotLegs, roundResidual, HOT_LIFT, type HotRound } from "../lib/hotround";
import type { Pick } from "../lib/picks";

// Team-goals prices for a match expected to score about 1.4 + 1.0 goals.
const odds = (h: number[], a: number[]) => {
  const o: Record<string, number> = {};
  h.forEach((p, k) => { o[`H_O${k}5`] = 0.96 / p; o[`H_U${k}5`] = 0.96 / (1 - p); });
  a.forEach((p, k) => { o[`A_O${k}5`] = 0.96 / p; o[`A_U${k}5`] = 0.96 / (1 - p); });
  return o;
};
const match = odds([0.75, 0.42, 0.17, 0.05, 0.01], [0.63, 0.27, 0.08, 0.02, 0.003]);

describe("hot rounds", () => {
  it("reads a match's expected goals from its team-goals prices", () => {
    // About 2.4 goals; the margin comes off with Shin's method, which trims long shots a little.
    const x = expectedGoals(match)!;
    expect(x).toBeGreaterThan(2.25);
    expect(x).toBeLessThan(2.45);
    expect(expectedGoals({ "1": 2 })).toBeNull();
  });
  it("measures a round's goals a match over its prices", () => {
    const x = expectedGoals(match)!;
    const r = roundResidual([{ hg: 2, ag: 2, odds: match }, { hg: 1, ag: 1, odds: match }, { hg: 9, ag: 9 }]);
    expect(r.matches).toBe(2);
    expect(r.resid).toBeCloseTo((4 + 2) / 2 - x, 5);
  });
  it("lifts overs and lowers unders by the measured amount", () => {
    expect(hotAdj("O25", 0.5)).toBeCloseTo(HOT_LIFT * 0.5);
    expect(hotAdj("FH_U15", 0.6)).toBeCloseTo(-HOT_LIFT * 0.4);
    expect(hotAdj("1", 0.5)).toBe(0);
  });
  it("builds the overs slip from the next round only, one leg per match at 1.20 or more", () => {
    const h: HotRound = { league: "Spain", kickoff: 0, resid: 0.4, matches: 10, next: 1000 };
    const pick = (e: string, m: string, o: number, ko = 1000, league = "Spain"): Pick => ({
      id: `${e}|${m}`, eventId: e, league, home: "A", away: "B", kickoff: ko, market: m, odds: o, breakEven: 1 / o,
      marketChance: 0.96 / o, estimate: 0.96 / o, lo: 0.9 / o, hi: 1 / o, historyRate: null, historyN: 0, edge: 0, grade: "Rough", why: "", source: "guarded",
    });
    const cands = applyHot([pick("a", "O15", 1.3), pick("a", "O05", 1.05), pick("a", "U25", 1.4), pick("b", "H_O05", 1.25),
      pick("c", "O15", 1.3, 2000), pick("d", "O15", 1.3, 1000, "Italy")], [h]);
    const legs = hotLegs(cands, h, () => 0);
    expect(legs.map((p) => p.id).sort()).toEqual(["a|O15", "b|H_O05"]);
    expect(cands.find((p) => p.id === "a|U25")!.hot!.adj).toBeLessThan(0);
    expect(cands.find((p) => p.id === "c|O15")!.hot).toBeUndefined();
  });
});
