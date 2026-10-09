import { blendEstimate, guardedEstimate, type BlendFile } from "./blend";
import { fairProbs } from "./markets";
import { estimate, history, modelDraws, type ModelFile } from "./model";
import { confidence, type Confidence } from "./plain";
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
  source: "guarded" | "blend";
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
  minConf?: Confidence;
  minChance?: number;
  now: number;
};

const CONF_RANK: Record<Confidence, number> = { Low: 0, Medium: 1, High: 2 };

/** Every (match, market) selection in the window that passes the filters, graded. */
export function candidates(model: ModelFile, fixtures: Fixture[], q: CandidateQuery, blend: BlendFile | null = null) {
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
      const raw = estimate(model, f.league, f.home, f.away, market);
      if (!raw) continue;
      const draws = blend?.markets[market]?.active ? modelDraws(model, f.league, f.home, f.away, market) : null;
      const b = draws && blendEstimate(blend, market, fair[market], draws.p, draws.reps);
      const est = b ?? guardedEstimate(fair[market], raw);
      const source: Pick["source"] = b ? "blend" : "guarded";
      const be = 1 / odds;
      const { grade, why } = gradeOf(be, est.lo, est.hi);
      if (grade === "Avoid") {
        avoided++;
        continue;
      }
      if (q.minGrade === "Lean" && grade !== "Lean") continue;
      if (q.minChance && est.p < q.minChance) continue;
      if (q.minConf && CONF_RANK[confidence(est.lo, est.hi)] < CONF_RANK[q.minConf]) continue;
      const h = history(model, f.league, f.home, f.away, market);
      out.push({
        id: `${f.eventId}|${market}`, eventId: f.eventId, league: f.league, home: f.home, away: f.away,
        kickoff: f.kickoff, market, odds, breakEven: be, marketChance: fair[market], estimate: est.p,
        lo: est.lo, hi: est.hi, historyRate: h.rate, historyN: h.n, edge: est.p * odds - 1, grade, why, source,
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
  const r = candidates(model, fixtures, { markets: [q.market], hours: q.hours, minOdds: 1, maxOdds: 1000, minGrade: q.minGrade, now: q.now }, null);
  const keep = [...r.candidates].sort((a, b) => (q.sort === "edge" ? b.edge - a.edge : b.estimate - a.estimate));
  return { picks: keep.slice(0, q.count), inWindow: r.matches, avoided: r.avoided, eligible: keep.length };
}

export { slipStats as slip } from "./slip";
