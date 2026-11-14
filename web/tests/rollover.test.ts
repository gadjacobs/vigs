import { describe, expect, it } from "vitest";
import { addStep, again, bank, mergeRollovers, milestones, newRollover, openStep, plan, progress, settleStep, type RLeg } from "../lib/rollover";

const leg = (odds: number, chance: number): RLeg => ({ eventId: "sr:match:1", market: "U35", label: "Under 3.5", home: "A", away: "B", league: "England", kickoff: 1, odds, chance });

describe("rollover", () => {
  it("plans steps, time and the chance of reaching the target", () => {
    const p = plan(5000, 5_000_000, 1.2, 1.2, 1);
    expect(p.steps).toBe(38);                  // 1.2^38 ≈ 1,026
    expect(p.hours).toBeCloseTo(38 * 40 / 60, 6);
    expect(p.chance).toBeGreaterThan(1 / 4000);
    expect(p.chance).toBeLessThan(1 / 1500);
    expect(plan(5000, 4000, 1.2, 1.2, 1).steps).toBe(0);
  });
  it("rolls a landed step into the pot and ends on a loss", () => {
    let r = newRollover({ start: 5000, target: 20000, lo: 1.2, hi: 1.4, perStep: 1 }, 100);
    r = addStep(r, { code: "AAAA11", legs: [leg(1.3, 0.75)] }, 200);
    expect(openStep(r)?.stake).toBe(5000);
    expect(addStep(r, { code: "BBBB22", legs: [leg(1.3, 0.75)] }).steps.length).toBe(1); // one step at a time
    r = settleStep(r, "won", 300);
    expect([r.pot, r.best, r.status]).toEqual([6500, 6500, "running"]);
    r = settleStep(addStep(r, { code: "CCCC33", legs: [leg(1.3, 0.75)] }), "lost");
    expect([r.pot, r.best, r.status]).toEqual([0, 6500, "lost"]);
  });
  it("stops at the target, gives a void stake back, banks between steps", () => {
    let r = newRollover({ start: 10000, target: 12000, lo: 1.2, hi: 1.4, perStep: 1 });
    r = settleStep(addStep(r, { code: "AAAA11", legs: [leg(1.25, 0.78)] }), "won");
    expect(r.status).toBe("reached");
    let v = newRollover({ start: 1000, target: 9000, lo: 1.2, hi: 1.4, perStep: 1 });
    v = settleStep(addStep(v, { code: "AAAA11", legs: [leg(1.25, 0.78)] }), "void");
    expect([v.pot, v.status]).toEqual([1000, "running"]);
    expect(bank(v).status).toBe("banked");
    expect(bank(addStep(v, { code: "BBBB22", legs: [leg(1.25, 0.78)] })).status).toBe("running"); // not mid-step
    expect(again(v).start).toBe(1000);
  });
  it("puts milestones and progress on a log scale", () => {
    expect(milestones(5000, 5_000_000)).toEqual([50000, 500000]);
    expect(progress(5000, 50000, 5_000_000)).toBeCloseTo(1 / 3, 9);
    expect(progress(5000, 4000, 5_000_000)).toBe(0);
  });
  it("merges devices by the latest change", () => {
    const a = newRollover({ start: 1000, target: 2000, lo: 1.2, hi: 1.4, perStep: 1 }, 1);
    const b = { ...a, pot: 1300, updated: a.updated + 5 };
    expect(mergeRollovers([a], [b])[0].pot).toBe(1300);
    expect(mergeRollovers([{ ...a, id: "bad" }], [])).toEqual([]);
  });
});
