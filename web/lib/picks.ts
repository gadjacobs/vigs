import { fairProbs } from "./markets";
import { estimate, history, type ModelFile } from "./model";
import type { Fixture } from "./sportybet";

export type Grade = "Lean" | "Rough" | "Avoid";

export type Pick = {
  eventId: string;
  league: string;
  home: string;
  away: string;
  kickoff: number;
  market: string;
  odds: number;
  breakEven: number;
  marketChance: number;
  estimate: number;
  lo: number;
  hi: number;
  historyRate: number | null;
  historyN: number;
  edge: number;
  grade: Grade;
  why: string;
};

/** Without odds history there is no walk-forward test, so nothing can be Solid. */
export function gradeOf(breakEven: number, lo: number, hi: number): { grade: Grade; why: string } {
  if (hi < breakEven) return { grade: "Avoid", why: "the whole 90% range sits below break-even" };
  if (lo > breakEven)
    return { grade: "Lean", why: "90% range above break-even; not yet validated on settled odds" };
  return { grade: "Rough", why: "likely, and priced for it: range straddles break-even" };
}

export type PickQuery = {
  market: string;
  hours: number;
  count: number;
  sort: "likely" | "edge";
  minGrade: "Rough" | "Lean";
  now: number;
};

export function buildPicks(model: ModelFile, fixtures: Fixture[], q: PickQuery) {
  const end = q.now + q.hours * 3600 * 1000;
  const inWindow = fixtures.filter((f) => f.kickoff > q.now && f.kickoff <= end && q.market in f.odds);
  const graded: Pick[] = [];
  for (const f of inWindow) {
    const est = estimate(model, f.league, f.home, f.away, q.market);
    const fair = fairProbs(f.odds)[q.market];
    if (!est || fair === undefined) continue;
    const odds = f.odds[q.market];
    const be = 1 / odds;
    const h = history(model, f.league, f.home, f.away, q.market);
    const { grade, why } = gradeOf(be, est.lo, est.hi);
    graded.push({
      eventId: f.eventId, league: f.league, home: f.home, away: f.away, kickoff: f.kickoff,
      market: q.market, odds, breakEven: be, marketChance: fair, estimate: est.p, lo: est.lo,
      hi: est.hi, historyRate: h.rate, historyN: h.n, edge: est.p * odds - 1, grade, why,
    });
  }
  const avoided = graded.filter((p) => p.grade === "Avoid").length;
  const keep = graded.filter((p) => (q.minGrade === "Lean" ? p.grade === "Lean" : p.grade !== "Avoid"));
  keep.sort((a, b) => (q.sort === "edge" ? b.edge - a.edge : b.estimate - a.estimate));
  return { picks: keep.slice(0, q.count), inWindow: inWindow.length, avoided, eligible: keep.length };
}

export function slip(picks: Pick[]) {
  const odds = picks.reduce((a, p) => a * p.odds, 1);
  const model = picks.reduce((a, p) => a * p.estimate, 1);
  const market = picks.reduce((a, p) => a * p.marketChance, 1);
  return { odds, model, market };
}
