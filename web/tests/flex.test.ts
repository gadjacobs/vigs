import { describe, expect, it } from "vitest";
import { flexLevels } from "../app/flex-row";
import { isFinal } from "../app/code-store";
import { atLeast } from "../lib/flex";
import type { Tracked } from "../lib/codes";

describe("flex", () => {
  it("offers up to two misses, three from ten legs", () => {
    expect(flexLevels(3)).toEqual([0, 1]);
    expect(flexLevels(6)).toEqual([0, 1, 2]);
    expect(flexLevels(10)).toEqual([0, 1, 2, 3]);
  });
  it("counts decided legs exactly", () => {
    expect(atLeast([1, 0, 0.5], 2)).toBeCloseTo(0.5, 9);
    expect(atLeast([1, 0, 0.5], 3)).toBe(0);
  });
});

const leg = (status: Tracked["legs"][number]["status"]) => ({
  eventId: "e", league: "", home: "", away: "", kickoff: Date.now(), market: "O15", label: "", status, score: null, ht: null, odds: 1.4, shareOdds: 1.4,
});
const code = (state: Tracked["state"], statuses: Tracked["legs"][number]["status"][]): Tracked => ({
  code: "X", legs: statuses.map(leg), state, won: 0, lost: 0, odds: 2, lastKickoff: Date.now(), deadline: 0, unavailable: 0, foreign: false,
});

describe("a code is final", () => {
  it("once it lands or every leg is decided", () => {
    expect(isFinal(code("won", ["won", "won"]))).toBe(true);
    expect(isFinal(code("lost", ["lost", "won"]))).toBe(true);
  });
  it("not while a lost code still has legs to play (Flex can still pay)", () => {
    expect(isFinal(code("lost", ["lost", "waiting", "won"]))).toBe(false);
    expect(isFinal(code("open", ["won", "playing"]))).toBe(false);
  });
});

describe("flex-friendly trim", async () => {
  const { flexFriendly, atLeast: al } = await import("../lib/flex");
  it("drops the shakiest legs until all but two land half the time", () => {
    const ps = [0.8, 0.8, 0.5, 0.8, 0.4, 0.8, 0.8, 0.3, 0.8, 0.8];
    expect(al(ps, 8)).toBeLessThan(0.5);
    const keep = flexFriendly(ps);
    expect(keep).not.toContain(7);
    expect(al(keep.map((i) => ps[i]), keep.length - 2)).toBeGreaterThanOrEqual(0.5);
    expect(keep).toEqual([...keep].sort((a, b) => a - b));
  });
  it("leaves a slip that already qualifies alone, and never goes under four legs", () => {
    expect(flexFriendly([0.95, 0.95, 0.95, 0.95, 0.95])).toEqual([0, 1, 2, 3, 4]);
    expect(flexFriendly([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]).length).toBe(4);
  });
});

import { flexQuote, FLEX_PAYBACK } from "../lib/flex";
import { buildSet } from "../lib/ourpicks";
import { applyFh, fhLikelier, fhShifts } from "../lib/fhusual";

describe("SportyBet Flex odds", () => {
  it("are the set payback over the chance that enough legs land", () => {
    // 4 legs at about 2.1 (20 odds) with one miss allowed: 3 of 4 land ~25%, pays ~2.6.
    const q = flexQuote([0.457, 0.457, 0.457, 0.457], 3)!;
    expect(q.chance).toBeCloseTo(atLeast([0.457, 0.457, 0.457, 0.457], 3), 12);
    expect(q.odds).toBeCloseTo(FLEX_PAYBACK / q.chance, 12);
    expect(q.odds).toBeGreaterThan(2.4);
    expect(q.odds).toBeLessThan(2.8);
    expect(flexQuote([0.5, 0.5], 3)).toBeNull();
  });

  it("the Flex set adds likeliest legs until the target is reached", () => {
    const cands = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}|U35`, eventId: `e${i}`, market: "U35", odds: 1.35, marketChance: 0.71, estimate: 0.71, lo: 0.68, hi: 0.74,
      kickoff: i, grade: "Rough", league: "England", home: "A", away: "B",
    })) as never[];
    const b = buildSet("flex", cands, { bar: 0, target: 100, n: 0, maxSlip: 50, floor: 1.3, misses: 1 });
    const k = b.slip.length;
    expect(flexQuote(Array(k).fill(0.71), k - 1)!.odds).toBeGreaterThanOrEqual(100);
    expect(flexQuote(Array(k - 1).fill(0.71), k - 2)!.odds).toBeLessThan(100);
  });
});

describe("first half against its usual", () => {
  const fx = (id: string, o: number, u: number) => ({ eventId: id, league: "England", home: id, away: "X", kickoff: 0, odds: { FH_O05: o, FH_U05: u } });
  const usual = { "England|a|X": 0.7, "England|b|X": 0.7 };
  const fixtures = [fx("a", 1.2, 4.5), fx("b", 1.6, 2.3)] as never[];   // a: FH goal ~77%, b: ~57%
  const pick = (id: string, market: string) => ({ eventId: id, market }) as never;
  it("keeps first-half overs when goals are likelier than usual and unders when less likely", () => {
    const s = fhShifts(fixtures, usual);
    expect(fhLikelier(pick("a", "FH_O05"), s)).toBe(true);
    expect(fhLikelier(pick("b", "FH_O05"), s)).toBe(false);
    expect(fhLikelier(pick("b", "FH_U15"), s)).toBe(true);
    expect(fhLikelier(pick("b", "O15"), s)).toBe(true);           // full-time legs pass
    const kept = applyFh([{ eventId: "a", market: "FH_O05" }, { eventId: "b", market: "FH_O05" }] as never[], fixtures, usual, true);
    expect(kept.map((p: { eventId: string }) => p.eventId)).toEqual(["a"]);
  });
});

import { multiBonus } from "../lib/bonus";

describe("SportyBet multi-bet bonus", () => {
  const legs = (n: number, o: number) => Array.from({ length: n }, () => ({ odds: o, p: 0.96 / o }));
  it("tops a multiple up toward single value, within the range for its qualifying legs", () => {
    const ten = multiBonus(legs(10, 1.35));
    expect(ten.qualifying).toBe(10);
    expect(ten.ratio).toBeCloseTo(0.33, 9);                 // wants +45%, capped at 33% for 10 legs
    expect(ten.extra).toBeCloseTo(1.35 ** 10 * 0.33, 6);
    const two = multiBonus(legs(2, 1.8));
    expect(two.ratio).toBeCloseTo(0.03, 9);                 // wants +4%, capped at 3%
  });
  it("counts only legs at 1.20 or more", () => {
    const b = multiBonus([...legs(3, 1.5), ...legs(5, 1.15)]);
    expect(b.qualifying).toBe(3);
    expect(b.extra).toBeCloseTo(1.5 ** 3 * b.ratio, 9);
    expect(multiBonus(legs(20, 1.16)).ratio).toBe(0);
  });
});
