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
