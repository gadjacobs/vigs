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
