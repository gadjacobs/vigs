import { atLeast } from "./flex";
import { LEG_RANGE, likeliestSlip, type Rule, type SearchMatch } from "./likelier";
import type { Pick } from "./picks";
import { slipConfidence, type Confidence } from "./plain";

// Cooked slips: a payout ladder. For each payout (2, 5, 10 ... 1,000 odds) the
// likeliest slip from the matches published now, found by an exact search
// (lib/likelier.ts). SportyBet's prices have matched results on our data, so
// at a given price a slip's chance is set by how much of the stake the
// bookmaker keeps, compounded per leg: fewer legs priced 1.5 to 5 keep the most.
// The 12 earlier styles built long slips from many short legs; the record showed
// Thousand keeping 66% of the stake on average and Goal stack 60%.

export type StyleId = string; // "x20" for the 20-odds rung; older records hold the earlier style names
export type Slate = {
  id: string; style: StyleId; name: string; blurb: string;
  legs: Pick[]; odds: number; chance: number; confidence: Confidence;
  first: number; last: number; flex?: { need: number; chance: number }[];
  code?: string;
  target?: number;      // the rung's payout
  keeps?: number;       // odds x chance: what the slip pays back per 1 staked, on average
  vsShort?: number;     // how many times likelier than the best slip from legs under 1.5 at this price
};

export const RUNGS = [2, 5, 10, 20, 50, 100, 1000] as const;
const market = (p: Pick) => p.marketChance;

/**
 * The best bet per match for a slip of about `k` legs: each match's likeliest
 * selection, except that no market may fill more than 40% of the slip, so a
 * match whose top market is already used offers its next one (double chance,
 * a team's goals, a first-half line ...).
 */
export function bestPerMatch(pool: Pick[], k: number): Pick[] {
  const cap = Math.max(1, Math.ceil(k * 0.4));
  const by = new Map<string, Pick[]>();
  for (const p of pool) (by.get(p.eventId) ?? by.set(p.eventId, []).get(p.eventId)!).push(p);
  const matches = [...by.values()].map((ps) => ps.sort((a, b) => market(b) - market(a)))
    .sort((a, b) => market(b[0]) - market(a[0]));
  const used: Record<string, number> = {};
  const out: Pick[] = [];
  for (const ps of matches) {
    const p = ps.find((x) => (used[x.market] ?? 0) < cap);
    if (!p) continue;
    used[p.market] = (used[p.market] ?? 0) + 1;
    out.push(p);
  }
  return out;
}


const allowed = (rule: Rule, m: string) =>
  rule === "goals" ? !/^(1|X|2|DC1X|DC12|DCX2)$/.test(m) : rule === "nodraw" ? m !== "X" : true;

function searchFrom(cands: Pick[], rule: Rule): SearchMatch[] {
  const by = new Map<string, Pick[]>();
  for (const p of cands) if (allowed(rule, p.market)) (by.get(p.eventId) ?? by.set(p.eventId, []).get(p.eventId)!).push(p);
  return [...by.entries()]
    .sort((a, b) => a[1][0].kickoff - b[1][0].kickoff || a[0].localeCompare(b[0]))
    .map(([id, ps]) => ({ id, options: ps.sort((a, b) => a.market.localeCompare(b.market)).map((p) => ({ market: p.market, odds: p.odds, chance: market(p) })) }));
}

const fmtOdds = (t: number) => t.toLocaleString("en-NG");

/** The likeliest slip at about `target` odds from these selections, or null. */
export function rung(cands: Pick[], target: number, rule: Rule = "any"): Slate | null {
  const pool = searchFrom(cands, rule);
  const byId = new Map(cands.map((p) => [p.id, p]));
  const picked = likeliestSlip(pool, target).map((c) => byId.get(`${c.id}|${c.market}`)!).filter(Boolean);
  if (!picked.length) return null;
  const legs = [...picked].sort((a, b) => a.kickoff - b.kickoff);
  const odds = legs.reduce((a, p) => a * p.odds, 1), chance = legs.reduce((a, p) => a * market(p), 1);
  const short = likeliestSlip(pool, target, 1.04, LEG_RANGE[0]);
  const shortChance = short.length ? short.reduce((a, c) => a * c.chance, 1) : null;
  const n = legs.length, ps = legs.map(market);
  return {
    id: `x${target}-${legs[0].kickoff}`, style: `x${target}`, name: `${fmtOdds(target)} odds`, target,
    blurb: n === 1
      ? `One selection near ${fmtOdds(target)}: a single keeps more of the stake than any slip at this price.`
      : `The likeliest ${n} legs near ${fmtOdds(target)} odds, each priced 1.5 to 5, from every match published now.`,
    legs, odds, chance, keeps: odds * chance, vsShort: shortChance ? chance / shortChance : undefined,
    confidence: slipConfidence(legs), first: legs[0].kickoff, last: legs[n - 1].kickoff,
    flex: n >= 4 ? [0, 1, 2].filter((m) => n - m >= 2).map((m) => ({ need: n - m, chance: atLeast(ps, n - m) })) : undefined,
  };
}

/** One slip per payout on the ladder (some rungs can be empty in a thin round). */
export function cookSlates(cands: Pick[], rule: Rule = "any", rungs: readonly number[] = RUNGS): Slate[] {
  return rungs.map((t) => rung(cands, t, rule)).filter((s): s is Slate => s !== null);
}
