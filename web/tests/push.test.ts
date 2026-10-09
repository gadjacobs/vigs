import { describe, expect, it } from "vitest";
import { dueTip, lagosAt } from "../lib/push";

describe("tip schedule", () => {
  const now = Date.UTC(2026, 9, 9, 20, 10); // 21:10 Lagos
  it("reads times as Lagos", () => {
    expect(lagosAt("21:00", now)).toBe(Date.UTC(2026, 9, 9, 20, 0));
    expect(lagosAt("00:30", Date.UTC(2026, 9, 9, 23, 40))).toBe(Date.UTC(2026, 9, 9, 23, 30)); // 00:40 Lagos next day
  });
  it("fires once, within 40 minutes", () => {
    expect(dueTip({ tips: ["21:00"], lastTip: 0 }, now)).toBe(Date.UTC(2026, 9, 9, 20, 0));
    expect(dueTip({ tips: ["21:00"], lastTip: now - 60_000 }, now)).toBeNull();
    expect(dueTip({ tips: ["20:00"], lastTip: 0 }, now)).toBeNull(); // 70 minutes late
    expect(dueTip({ tips: ["21:30"], lastTip: 0 }, now)).toBeNull(); // not yet
    expect(dueTip({ tips: ["23:50"], lastTip: 0 }, Date.UTC(2026, 9, 9, 23, 5))).toBe(Date.UTC(2026, 9, 9, 22, 50)); // 00:05 Lagos
  });
});
