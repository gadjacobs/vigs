import { describe, expect, it } from "vitest";
import type { Pick } from "../lib/picks";
import { smartSwitch, toTarget, topN } from "../lib/slip";

let seq = 0;
function pick(eventId: string, market: string, odds: number, estimate: number): Pick {
  seq++;
  return {
    id: `${eventId}|${market}`, eventId, league: "England", home: `H${seq}`, away: `A${seq}`, kickoff: 0,
    market, odds, breakEven: 1 / odds, marketChance: 0.9 / odds, estimate, lo: estimate - 0.02,
    hi: estimate + 0.02, historyRate: null, historyN: 0, edge: estimate * odds - 1, grade: "Rough", why: "", source: "model",
  };
}

const cands = [
  pick("e1", "O15", 1.3, 0.8), pick("e1", "BY", 1.9, 0.55),
  pick("e2", "O15", 1.25, 0.82), pick("e3", "O15", 1.5, 0.7),
  pick("e4", "FH_O05", 1.4, 0.75), pick("e5", "O25", 2.0, 0.52),
  pick("e6", "O15", 1.2, 0.85), pick("e7", "BY", 1.8, 0.6),
];

function brute(target: number, slack: number) {
  let best: { p: number; legs: Pick[] } | null = null;
  const byEvent = [...new Set(cands.map((c) => c.eventId))].map((e) => cands.filter((c) => c.eventId === e));
  const walk = (i: number, legs: Pick[]) => {
    if (i === byEvent.length) {
      const o = legs.reduce((a, l) => a * l.odds, 1);
      const p = legs.reduce((a, l) => a * l.estimate, 1);
      if (legs.length && o >= target && o <= target * (1 + slack) && (!best || p > best.p)) best = { p, legs: [...legs] };
      return;
    }
    walk(i + 1, legs);
    for (const c of byEvent[i]) walk(i + 1, [...legs, c]);
  };
  walk(0, []);
  return best as { p: number; legs: Pick[] } | null;
}

describe("slip building", () => {
  it("topN keeps one selection per match", () => {
    const s = topN(cands, 10, "likely");
    expect(new Set(s.map((p) => p.eventId)).size).toBe(s.length);
    expect(s[0].estimate).toBeGreaterThanOrEqual(s[s.length - 1].estimate);
  });

  it("toTarget matches brute force within rounding", () => {
    for (const target of [2, 3, 5, 10]) {
      const s = toTarget(cands, target, 0.25);
      const b = brute(target * 1.01, 0.23); // grid rounding: compare on a slightly inner band
      const odds = s.reduce((a, l) => a * l.odds, 1);
      const p = s.reduce((a, l) => a * l.estimate, 1);
      expect(odds).toBeGreaterThanOrEqual(target * 0.985);
      expect(odds).toBeLessThanOrEqual(target * 1.25 * 1.015);
      expect(new Set(s.map((l) => l.eventId)).size).toBe(s.length);
      if (b) expect(p).toBeGreaterThanOrEqual(b.p - 1e-9);
    }
  });

  it("returns an empty slip when the target cannot be reached", () => {
    expect(toTarget(cands.slice(0, 2), 1000)).toEqual([]);
  });

  it("smart switch keeps the price close and avoids matches already used", () => {
    const s = [cands[0], cands[2], cands[3]];
    const alt = smartSwitch(s, cands, cands[3].id)!;
    expect(alt).toBeTruthy();
    expect(["e2", "e1"]).not.toContain(alt.eventId);
    expect(Math.abs(Math.log(alt.odds / 1.5))).toBeLessThanOrEqual(Math.log(1.15) + 1e-9);
  });
});
