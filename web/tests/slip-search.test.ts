import { describe, expect, it } from "vitest";
import { bestSlip } from "../lib/likelier";
import type { Fixture } from "../lib/sportybet";
import data from "./slip-search.json";

// Reference cases written by vigs.odds.likeliest_slip on 40 real upcoming matches.
describe("likeliest slip", () => {
  const fixtures = data.fixtures as Fixture[];
  for (const c of data.cases) {
    it(`matches Python: ${c.rule}, odds ${c.target}`, () => {
      const s = bestSlip(fixtures, c.target, c.rule as "any" | "goals")!;
      expect(s.legs.map((l) => [l.id, l.market])).toEqual(c.legs);
      expect(s.chance).toBeCloseTo(c.chance, 9);
    });
  }
  it("finds nothing when no slip reaches the payout", () => {
    expect(bestSlip(fixtures.slice(0, 1), 1e9)).toBeNull();
  });
});
