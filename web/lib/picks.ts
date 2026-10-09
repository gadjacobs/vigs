import { fairProbs } from "./markets";
import { estimate, history, type ModelFile } from "./model";
import type { Fixture } from "./sportybet";

export type Grade = "Lean" | "Rough" | "Avoid";

export type Pick = {
  id: string; // eventId|market
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

export type CandidateQuery = {
  markets: string[];
  hours: number;
  minOdds: number;
  maxOdds: number;
  minGrade: "Rough" | "Lean";
  now: number;
};

/** Every (match, market) selection in the window that passes the filters, graded. */
export function candidates(model: ModelFile, fixtures: Fixture[], q: CandidateQuery) {
  const end = q.now + q.hours * 3600 * 1000;
  const inWindow = fixtures.filter((f) => f.kickoff > q.now && f.kickoff <= end);
  const out: Pick[] = [];
  let avoided = 0;
  for (const f of inWindow) {
    const fair = fairProbs(f.odds);
    for (const market of q.markets) {
      const odds = f.odds[market];
      if (odds === undefined || fair[market] === undefined) continue;
      if (odds < q.minOdds || odds > q.maxOdds) continue;
      const est = estimate(model, f.league, f.home, f.away, market);
      if (!est) continue;
      const be = 1 / odds;
      const { grade, why } = gradeOf(be, est.lo, est.hi);
      if (grade === "Avoid") {
        avoided++;
        continue;
      }
      if (q.minGrade === "Lean" && grade !== "Lean") continue;
      const h = history(model, f.league, f.home, f.away, market);
      out.push({
        id: `${f.eventId}|${market}`, eventId: f.eventId, league: f.league, home: f.home, away: f.away,
        kickoff: f.kickoff, market, odds, breakEven: be, marketChance: fair[market], estimate: est.p,
        lo: est.lo, hi: est.hi, historyRate: h.rate, historyN: h.n, edge: est.p * odds - 1, grade, why,
      });
    }
  }
  return { candidates: out, matches: inWindow.length, avoided };
}

/** Backwards-compatible single-market list. */
export function buildPicks(
  model: ModelFile,
  fixtures: Fixture[],
  q: { market: string; hours: number; count: number; sort: "likely" | "edge"; minGrade: "Rough" | "Lean"; now: number },
) {
  const r = candidates(model, fixtures, { markets: [q.market], hours: q.hours, minOdds: 1, maxOdds: 1000, minGrade: q.minGrade, now: q.now });
  const keep = [...r.candidates].sort((a, b) => (q.sort === "edge" ? b.edge - a.edge : b.estimate - a.estimate));
  return { picks: keep.slice(0, q.count), inWindow: r.matches, avoided: r.avoided, eligible: keep.length };
}

export { slipStats as slip } from "./slip";
