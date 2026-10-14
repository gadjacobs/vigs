import { describe, expect, it } from "vitest";
import { habitNotes } from "../lib/habits";
import type { CodeGroup } from "../lib/record";

const row = (settled: number, landed: number, exp: number, roi: number) => ({ settled, landed, expected_market: exp, odds: 2, roi });
const g: CodeGroup = {
  codes: 60, settled: 58, landed: 8, expected_vig: 7, expected_market: 6.4, roi: -0.6,
  legs: { settled: 400, hits: 300, expected_vig: 298, expected_market: 296 },
  recent: [],
  markets: { FH_U25: { settled: 354, hits: 301, expected_vig: 299, expected_market: 298.4 }, BY: { settled: 50, hits: 20, expected_vig: 27, expected_market: 27.5 } },
  habits: {
    length: { "2-3 legs": row(20, 8, 5.3, 0.2), "11-20 legs": row(35, 0, 0.6, -1), "4-6 legs": row(3, 0, 0.2, -1) },
    time: {}, origin: {},
  },
};

describe("habit notes", () => {
  const notes = habitNotes(g, 1000);
  it("compares slip lengths with enough codes", () => {
    expect(notes[0]).toContain("2-3-leg slips landed 8 of 20");
    expect(notes[0]).toContain("11-20-leg slips landed 0 of 35");
  });
  it("calls out long slips that never landed", () => {
    expect(notes.some((n) => n.includes("None of your 35 slips with more than 10 legs"))).toBe(true);
  });
  it("names a market only when it is clearly off its price", () => {
    expect(notes.some((n) => n.includes("both teams score legs landed 20 of 50"))).toBe(true);
    expect(notes.some((n) => n.includes("first half under 2.5"))).toBe(false);
  });
  it("estimates the result at the usual stake", () => {
    expect(notes.at(-1)).toContain("−₦34,800");
  });
  it("says nothing without enough codes", () => {
    expect(habitNotes({ ...g, settled: 3, markets: {}, habits: { length: {}, time: {}, origin: {} } }, 1000)).toEqual([]);
  });
});
