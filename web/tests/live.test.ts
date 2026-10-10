import { describe, expect, it } from "vitest";
import { decided, legChance, slipChance } from "../lib/live";
import { hedgePlan, opposite } from "../lib/hedge";
import { parseLive, parseOdds, selection } from "../lib/sportybet";

const ev = (phase: string, score: [number, number], fh: [number, number] | null, prob: Record<string, number> = {}) =>
  ({ eventId: "e", phase, minute: 30, score, fh, odds: {}, prob });

describe("live legs", () => {
  it("decides overs and both-teams-score early, unders only when beaten", () => {
    expect(decided("O25", ev("H1", [2, 1], [2, 1]))).toBe(true);
    expect(decided("U25", ev("H2", [2, 1], [1, 0]))).toBe(false);
    expect(decided("U25", ev("H2", [1, 1], [1, 0]))).toBeNull();
    expect(decided("BY", ev("H2", [1, 1], [1, 0]))).toBe(true);
    expect(decided("BN", ev("H2", [1, 1], [1, 0]))).toBe(false);
    expect(decided("1", ev("H2", [3, 0], [2, 0]))).toBeNull();
  });

  it("settles first-half lines from the half-time score once the half is over", () => {
    expect(decided("FH_U15", ev("H1", [1, 0], [1, 0]))).toBeNull();
    expect(decided("FH_U15", ev("H2", [1, 3], [1, 0]))).toBe(true);
    expect(decided("FH_O05", ev("H2", [0, 2], [0, 0]))).toBe(false);
    expect(decided("FH_O05", ev("H1", [0, 1], [0, 1]))).toBe(true);
  });

  it("uses SportyBet's live probability while undecided", () => {
    expect(legChance("U25", ev("H2", [1, 0], [1, 0], { U25: 0.62 }))).toBe(0.62);
    expect(legChance("O05", ev("H1", [1, 0], [1, 0], { O05: 0.5 }))).toBe(1);
    expect(slipChance([1, 0.5, 0.8])).toBeCloseTo(0.4, 12);
    expect(slipChance([1, null])).toBeNull();
  });

  it("reads the live feed's score, clock and probabilities", () => {
    const l = parseLive({
      eventId: "e", estimateStartTime: 0, homeTeamName: "A", awayTeamName: "B", sport: { category: { name: "England" } },
      matchStatus: "H2", playedSeconds: "61:00", setScore: "1:2", gameScore: ["1:0", "0:2"],
      markets: [{ id: "1", status: 0, outcomes: [
        { desc: "Home", odds: "4.10", probability: "0.23", isActive: 1 },
        { desc: "Draw", odds: "3.20", probability: "0.30", isActive: 1 },
        { desc: "Away", odds: "2.05", probability: "0.47", isActive: 1 }] }],
    });
    expect([l.phase, l.minute, l.score, l.fh]).toEqual(["H2", 61, [1, 2], [1, 0]]);
    expect(l.odds["2"]).toBe(2.05);
    expect(l.prob.X).toBe(0.3);
  });
});

describe("hedge", () => {
  it("covers each leg with the selection that wins when it loses", () => {
    expect(opposite("1")).toBe("DCX2");
    expect(opposite("X")).toBe("DC12");
    expect(opposite("FH_O15")).toBe("FH_U15");
    expect(opposite("U35")).toBe("O35");
    expect(opposite("BN")).toBe("BY");
    expect(selection("DCX2", "e")).toEqual({ eventId: "e", marketId: "10", specifier: null, outcomeId: "11" });
    const dc = parseOdds({ markets: [{ id: "10", status: 0, outcomes: [
      { desc: "Home or Draw", odds: "1.30", isActive: 1 }, { desc: "Home or Away", odds: "1.25", isActive: 1 },
      { desc: "Draw or Away", odds: "1.90", isActive: 1 }] }] });
    expect(dc).toEqual({ DC1X: 1.3, DC12: 1.25, DCX2: 1.9 });
  });

  it("covers for the same net result either way and prices what that gives up", () => {
    // ₦1,000 slip paying ₦10,000; last leg at 60%, opposite priced 2.30
    const h = hedgePlan(1000, 10_000, 2.3, 0.6);
    const ifLands = 10_000 - h.cover.stake - 1000;
    const ifFails = h.cover.stake * 2.3 - h.cover.stake - 1000;
    expect(ifLands).toBeCloseTo(ifFails, 9);
    expect(h.cover.net).toBeCloseTo(4652.17, 2);
    expect(h.hold.average).toBeCloseTo(5000, 9);
    expect(h.coverCost).toBeCloseTo(10_000 * (1 / 2.3 - 0.4), 9);
    expect(h.back!.stake * 2.3 - h.back!.stake - 1000).toBeCloseTo(0, 9);
  });
});
