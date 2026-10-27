import { describe, expect, it } from "vitest";
import type { Pick } from "../lib/picks";
import { smartSwitch, toTarget, topN } from "../lib/slip";

let seq = 0;
function pick(eventId: string, market: string, odds: number, estimate: number): Pick {
  seq++;
  return {
    id: `${eventId}|${market}`, eventId, league: "England", home: `H${seq}`, away: `A${seq}`, kickoff: 0,
    market, odds, breakEven: 1 / odds, marketChance: 0.9 / odds, estimate, lo: estimate - 0.02,
    hi: estimate + 0.02, historyRate: null, historyN: 0, edge: estimate * odds - 1, grade: "Rough", why: "", source: "guarded",
  };
}

const cands = [
  pick("e1", "O15", 1.3, 0.8), pick("e1", "BY", 1.9, 0.55),
  pick("e2", "O15", 1.25, 0.82), pick("e3", "O15", 1.5, 0.7),
  pick("e4", "FH_O05", 1.4, 0.75), pick("e5", "O25", 2.0, 0.52),
  pick("e6", "O15", 1.2, 0.85), pick("e7", "BY", 1.8, 0.6),
];

function brute(target: number, slack: number, low = target) {
  let best: { p: number; legs: Pick[] } | null = null;
  const byEvent = [...new Set(cands.map((c) => c.eventId))].map((e) => cands.filter((c) => c.eventId === e));
  const walk = (i: number, legs: Pick[]) => {
    if (i === byEvent.length) {
      const o = legs.reduce((a, l) => a * l.odds, 1);
      const p = legs.reduce((a, l) => a * l.estimate, 1);
      if (legs.length && o >= low && o <= target * (1 + slack) && (!best || p > best.p)) best = { p, legs: [...legs] };
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

  it("toTarget lands within target ± tolerance and matches brute force", () => {
    for (const [target, tol] of [[2, 0.1], [3, 0.1], [5, 0.1], [10, 0.2], [20.2, 0.1]] as const) {
      const s = toTarget(cands, target, tol);
      // grid rounding: compare against brute force on a slightly inner band
      const b = brute(target * (1 - tol) * 1.01, (target * (1 + tol) * 0.99) / (target * (1 - tol) * 1.01) - 1, target * (1 - tol) * 1.01);
      if (!s.length) { expect(b).toBeNull(); continue; }
      const odds = s.reduce((a, l) => a * l.odds, 1);
      const p = s.reduce((a, l) => a * l.estimate, 1);
      expect(odds).toBeGreaterThanOrEqual(target * (1 - tol) * 0.985);
      expect(odds).toBeLessThanOrEqual(target * (1 + tol) * 1.015);
      expect(new Set(s.map((l) => l.eventId)).size).toBe(s.length);
      if (b) expect(p).toBeGreaterThanOrEqual(b.p - 1e-9);
    }
  });

  it("respects the maximum number of legs", () => {
    const s = toTarget(cands, 5, 0.1, 2);
    expect(s.length).toBeLessThanOrEqual(2);
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

import { ourPicks } from "../lib/ourpicks";

describe("our picks", () => {
  it("takes the best-paying selection at or above the bar, one per match", () => {
    const p = (eventId: string, market: string, odds: number, estimate: number, kickoff = 1) =>
      ({ id: `${eventId}|${market}`, eventId, market, odds, estimate, kickoff }) as never;
    const out = ourPicks([p("a", "FH_U35", 1.04, 0.96), p("a", "U45", 1.12, 0.9), p("a", "O15", 1.3, 0.77),
      p("b", "O05", 1.08, 0.91, 0), p("c", "U45", 1.2, 0.85)], 0.88);
    expect(out.map((x: { id: string }) => x.id)).toEqual(["b|O05", "a|U45"]);
  });
});

import { atLeast, landedDist } from "../lib/flex";

describe("flex", () => {
  it("adds up and matches the binomial", () => {
    const d = landedDist([0.3, 0.3, 0.3]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(d[3]).toBeCloseTo(0.027, 12);
    expect(atLeast([0.3, 0.3, 0.3], 2)).toBeCloseTo(0.216, 12);
    expect(atLeast([0.5], 0)).toBe(1);
  });
});

import { buildSet } from "../lib/ourpicks";

describe("our picks sets", () => {
  const p = (eventId: string, market: string, odds: number, estimate: number, lo = estimate - 0.01, hi = estimate + 0.01) =>
    ({ id: `${eventId}|${market}`, eventId, market, odds, estimate, lo, hi, kickoff: 1 }) as never;
  const cands = [p("a", "X", 3.4, 0.29), p("b", "X", 3.6, 0.27), p("c", "X", 3.2, 0.3), p("a", "O15", 1.5, 0.66),
    p("b", "O15", 1.9, 0.52), p("c", "BY", 2.0, 0.48, 0.4, 0.55), p("d", "1", 1.6, 0.62), p("e", "2", 1.7, 0.58)];
  const o = { bar: 0.88, target: 5, n: 2, maxSlip: 30 };
  it("draws: likeliest first", () => {
    expect(buildSet("draws", cands, o).slip.map((x: { eventId: string }) => x.eventId)).toEqual(["c", "a"]);
  });
  it("bold: High confidence only", () => {
    expect(buildSet("bold", cands, o).pool.map((x: { id: string }) => x.id)).toEqual(["b|O15"]);
  });
  it("odds: short legs near the target", () => {
    const s = buildSet("odds", cands, o).slip as unknown as { odds: number }[];
    const total = s.reduce((a, x) => a * x.odds, 1);
    expect(total).toBeGreaterThanOrEqual(4.5);
    expect(total).toBeLessThanOrEqual(5.5);
    expect(s.every((x) => x.odds <= 2.2)).toBe(true);
  });
});

import { plain, whatsapp, xPost } from "../lib/sharetext";

describe("share text", () => {
  const legs = Array.from({ length: 14 }, (_, i) => ({ home: "AAA", away: "BBB", label: "Over 1.5", odds: 1.3, kickoff: 0, status: i ? "waiting" : "won", score: null }));
  const d = { code: "ABC123", legs, odds: 39.37, chance: 0.04, state: "open" as const, stake: 1000 };
  it("fits X and formats WhatsApp", () => {
    expect(xPost(d).length).toBeLessThanOrEqual(280);
    expect(xPost(d)).toContain("ABC123");
    expect(whatsapp(d)).toContain("*SportyBet code: ABC123*");
    expect(whatsapp(d)).toContain("?shareCode=ABC123");
    expect(plain(d)).not.toContain(d.legs[0].home);
    expect(plain(d)).not.toContain("*");
  });
});

import { cookSlates } from "../lib/slates";

describe("cooked Double up keeps its legs close together", () => {
  // High-confidence legs (lo/hi close), marketChance set directly.
  const leg = (e: string, ko: number, odds: number, mc: number): Pick => ({
    ...pick(e, "O15", odds, mc), kickoff: ko, marketChance: mc, lo: mc - 0.01, hi: mc + 0.01,
  });
  const MIN = 60_000;
  it("stays in the first round when a later one is only a little likelier", () => {
    const first = [leg("a", 0, 1.35, 0.71), leg("b", 0, 1.35, 0.71)];
    const later = [leg("c", 120 * MIN, 1.35, 0.72), leg("d", 120 * MIN, 1.35, 0.72)];
    const d = cookSlates([...first, ...later]).find((s) => s.style === "double")!;
    expect(d.legs.map((p) => p.kickoff)).toEqual([0, 0]);
  });
  it("reaches a later round when it is clearly likelier", () => {
    const first = [leg("a", 0, 1.35, 0.66), leg("b", 0, 1.35, 0.66)];
    const later = [leg("c", 30 * MIN, 1.35, 0.72), leg("d", 30 * MIN, 1.35, 0.72)];
    const d = cookSlates([...first, ...later]).find((s) => s.style === "double")!;
    expect(d.chance).toBeGreaterThan(0.5);
    expect(d.legs.every((p) => p.kickoff === 30 * MIN)).toBe(true);
  });
});

describe("cooked target slips lean toward markets that held their price", () => {
  const leg = (e: string, m: string, odds: number, mc: number): Pick => ({
    ...pick(e, m, odds, mc), market: m, kickoff: 0, marketChance: mc, lo: mc - 0.01, hi: mc + 0.01,
  });
  it("prefers the market whose record is above its price at the same odds", () => {
    const cands = [leg("a", "O15", 1.35, 0.71), leg("a", "H_O05", 1.35, 0.71), leg("b", "O15", 1.35, 0.71), leg("b", "H_O05", 1.35, 0.71)];
    const lean = [
      { market: "H_O05", lo: 0.67, hi: 0.8, n: 20000, landed: 14600, priced: 14200, z: 3, held: true },
      { market: "O15", lo: 0.67, hi: 0.8, n: 20000, landed: 14000, priced: 14200, z: -2, held: true },
    ];
    const d = cookSlates(cands, lean as never).find((s) => s.style === "double")!;
    expect(d.legs.every((p) => p.market === "H_O05")).toBe(true);
  });
});

import { cheaperSwap } from "../lib/slip";

describe("Make it cheaper", () => {
  const leg = (e: string, m: string, odds: number, mc: number): Pick => ({ ...pick(e, m, odds, mc), market: m, marketChance: mc });
  it("swaps the costly leg for a cheaper one at about the same odds", () => {
    const a = leg("a", "O15", 1.5, 0.6), b = leg("b", "O15", 1.5, 0.64);
    const c = leg("a", "H_O05", 1.52, 0.64), far = leg("z", "O25", 3.0, 0.32);
    const sw = cheaperSwap([a, b], [a, b, c, far])!;
    expect(sw.out.id).toBe(a.id);
    expect(sw.inn.id).toBe(c.id);
    expect(sw.keep).toBeGreaterThan(sw.before);
  });
  it("says nothing is cheaper when nothing is", () => {
    const a = leg("a", "O15", 1.5, 0.64), b = leg("b", "O15", 1.5, 0.64);
    expect(cheaperSwap([a, b], [a, b, leg("c", "O15", 1.5, 0.6)])).toBeNull();
  });
});
