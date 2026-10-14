import { describe, expect, it } from "vitest";
import { judge, mayTell, signature, type SlipWatch } from "../lib/watches";

const leg = (id: string, p: number, odds: number) => ({ id, eventId: id, market: "U35", estimate: p, marketChance: p, odds, kickoff: 0 }) as never;
const legs = [leg("a", 0.9, 1.1), leg("b", 0.8, 1.2), leg("c", 0.7, 1.4), leg("d", 0.6, 1.6)];
const w = (o: Partial<SlipWatch>): SlipWatch => ({ id: "x", source: "template:trusted", minLegs: 3, ...o });

describe("slip alerts", () => {
  it("a template qualifies with enough legs, judged on its top legs", () => {
    const hit = judge(w({}), legs)!;
    expect(hit.legs.length).toBe(3);
    expect(hit.chance).toBeCloseTo(0.9 * 0.8 * 0.7, 9);
    expect(judge(w({ minLegs: 5 }), legs)).toBeNull();
  });
  it("a saved filter is judged on its whole slip, with chance and odds bars", () => {
    expect(judge(w({ source: "filter:Evening", minLegs: 4 }), legs)!.legs.length).toBe(4);
    expect(judge(w({ source: "filter:Evening", minLegs: 2, minChance: 0.5 }), legs)).toBeNull();
    expect(judge(w({ source: "filter:Evening", minLegs: 2, minOdds: 3 }), legs)).toBeNull();
  });
  it("sends a changed slip at most every 2 hours, never at night in Lagos", () => {
    const noon = Date.UTC(2026, 9, 15, 11); // 12:00 Lagos
    const night = Date.UTC(2026, 9, 15, 2); // 03:00 Lagos
    expect(mayTell(null, "s1", noon)).toBe(true);
    expect(mayTell(null, "s1", night)).toBe(false);
    expect(mayTell({ at: noon - 3600_000, sig: "s0" }, "s1", noon)).toBe(false);
    expect(mayTell({ at: noon - 3 * 3600_000, sig: "s1" }, "s1", noon)).toBe(false);
    expect(mayTell({ at: noon - 3 * 3600_000, sig: "s0" }, "s1", noon)).toBe(true);
  });
  it("signatures ignore leg order", () => {
    expect(signature([legs[1], legs[0]])).toBe(signature([legs[0], legs[1]]));
  });
});
