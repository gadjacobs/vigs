import { describe, expect, it } from "vitest";
import { fairProbs } from "../lib/markets";
import { probs } from "../lib/poisson";
import { buildPicks, gradeOf } from "../lib/picks";
import { parseOdds, selection } from "../lib/sportybet";
import type { ModelFile } from "../lib/model";

describe("poisson", () => {
  it("matches the Python model to 1e-9", () => {
    const p = probs(1.5, 1.1, 0.5);
    const py: Record<string, number> = {
      "1": 0.464244177983, X: 0.257667214776, BY: 0.518272329007,
      O15: 0.732615110425, FH_O05: 0.727468206964, U25: 0.518429575936,
    };
    for (const [k, v] of Object.entries(py)) expect(p[k]).toBeCloseTo(v, 9);
  });
});

describe("markets", () => {
  it("de-vigs complete groups only", () => {
    const q = fairProbs({ "1": 2, X: 3.5, "2": 4, O15: 1.3 });
    expect(q["1"] + q.X + q["2"]).toBeCloseTo(1, 12);
    expect(q.O15).toBeUndefined();
  });
});

describe("sportybet", () => {
  it("parses markets and drops suspended groups", () => {
    const odds = parseOdds({
      eventId: "e", estimateStartTime: 0, homeTeamName: "A", awayTeamName: "B",
      sport: { category: { name: "England" } },
      markets: [
        { id: "1", status: 0, outcomes: [{ desc: "Home", odds: "2.1", isActive: 1 }, { desc: "Draw", odds: "3.4", isActive: 1 }, { desc: "Away", odds: "3.3", isActive: 1 }] },
        { id: "68", specifier: "total=0.5", status: 0, outcomes: [{ desc: "Over 0.5", odds: "1.25", isActive: 1 }, { desc: "Under 0.5", odds: "4.1", isActive: 1 }] },
        { id: "18", specifier: "total=6.5", status: 0, outcomes: [{ desc: "Over 6.5", odds: "23", isActive: 1 }, { desc: "Under 6.5", odds: "1.00", isActive: 0 }] },
        { id: "29", status: 0, outcomes: [{ desc: "Yes", odds: "1.95", isActive: 1 }, { desc: "No", odds: "1.85", isActive: 1 }] },
      ],
    });
    expect(odds).toEqual({ "1": 2.1, X: 3.4, "2": 3.3, FH_O05: 1.25, FH_U05: 4.1, BY: 1.95, BN: 1.85 });
  });
  it("builds booking selections like the Python client", () => {
    expect(selection("O15", "e")).toEqual({ eventId: "e", marketId: "18", specifier: "total=1.5", outcomeId: "12" });
    expect(selection("FH_O05", "e")).toEqual({ eventId: "e", marketId: "68", specifier: "total=0.5", outcomeId: "12" });
    expect(selection("BY", "e")).toEqual({ eventId: "e", marketId: "29", specifier: null, outcomeId: "74" });
  });
});

describe("picks", () => {
  it("never grades above Lean and ranks by likelihood", () => {
    expect(gradeOf(0.7, 0.72, 0.8).grade).toBe("Lean");
    expect(gradeOf(0.7, 0.65, 0.75).grade).toBe("Rough");
    expect(gradeOf(0.7, 0.6, 0.68).grade).toBe("Avoid");
    const lg = { home: 1.1, fh_share: 0.5, attack: { A: 1.4, B: 1.0, C: 0.8 }, defence: { A: 0.8, B: 1.0, C: 1.2 } };
    const model: ModelFile = {
      version: 1, fitted_on: 0, from: "", to: "",
      leagues: { England: { ...lg, reps: [lg, lg] } },
      history: { England: { A: { home: { n: 10, O15: 8 } }, C: { away: { n: 10, O15: 6 } } } },
    };
    const now = 1_000_000;
    const fx = (home: string, away: string, odds: number) => ({
      eventId: home + away, league: "England", home, away, kickoff: now + 600_000,
      odds: { O15: odds, U15: 3.2 },
    });
    const r = buildPicks(model, [fx("A", "C", 1.6), fx("B", "B", 1.6), fx("C", "A", 1.6)], {
      market: "O15", hours: 1, count: 10, sort: "likely", minGrade: "Rough", now,
    });
    expect(r.inWindow).toBe(3);
    expect(r.picks[0].home).toBe("A");
    expect(r.picks[0].historyRate).toBeCloseTo(0.7);
    for (let i = 1; i < r.picks.length; i++) expect(r.picks[i - 1].estimate).toBeGreaterThanOrEqual(r.picks[i].estimate);
  });
});
