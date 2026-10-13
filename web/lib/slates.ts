import { atLeast } from "./flex";
import type { Pick } from "./picks";
import { confidence, slipConfidence, type Confidence } from "./plain";
import { MAX_LEGS, toTarget } from "./slip";

// Cooked slips: ready-made, named slips for the rounds published right now.
// Which slips appear, and how many legs each has, depends on what the round
// offers: a slip is only cooked when enough legs clear its confidence bar.
// Built on the data so far (see Record, "What the data says"): short prices
// keep value, long shots lose it; market and model agreeing is what
// confidence measures; draws are priced per league and land about 1 in 4.

export type StyleId = "steady" | "double" | "fiver" | "tenner" | "long" | "hundred" | "thousand" | "stack" | "goals" | "tight" | "bold" | "draws";
export type Slate = {
  id: string; style: StyleId; name: string; blurb: string;
  legs: Pick[]; odds: number; chance: number; confidence: Confidence;
  first: number; last: number; flex?: { need: number; chance: number }[];
  code?: string;
};

const rank: Record<Confidence, number> = { Low: 0, Medium: 1, High: 2 };
const conf = (p: Pick) => confidence(p.lo, p.hi);
const atLeastConf = (c: Confidence) => (p: Pick) => rank[conf(p)] >= rank[c];

function onePerMatch(ps: Pick[], key: (p: Pick) => number): Pick[] {
  const best = new Map<string, Pick>();
  for (const p of ps) {
    const b = best.get(p.eventId);
    if (!b || key(p) > key(b)) best.set(p.eventId, p);
  }
  return [...best.values()].sort((a, b) => key(b) - key(a));
}

function make(style: StyleId, name: string, blurb: string, legs: Pick[], flex = false): Slate | null {
  if (legs.length < 2) return null;
  const sorted = [...legs].sort((a, b) => a.kickoff - b.kickoff);
  const ps = sorted.map((p) => p.estimate);
  const n = sorted.length;
  return {
    id: `${style}-${sorted[0].kickoff}`, style, name, blurb, legs: sorted,
    odds: sorted.reduce((a, p) => a * p.odds, 1), chance: ps.reduce((a, p) => a * p, 1),
    confidence: slipConfidence(sorted), first: sorted[0].kickoff, last: sorted[n - 1].kickoff,
    flex: flex ? [0, 1, 2, 3].filter((m) => n - m >= 1 && (m < 3 || n >= 10)).map((m) => ({ need: n - m, chance: atLeast(ps, n - m) })) : undefined,
  };
}

/** Try High-confidence legs first, then Medium; name the slip after what it used. */
function byConfidence(pool: Pick[], build: (legs: Pick[]) => Pick[]): Pick[] {
  for (const c of ["High", "Medium"] as const) {
    const legs = build(pool.filter(atLeastConf(c)));
    if (legs.length >= 2) return legs;
  }
  return [];
}

const word = ["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

// Legs are ranked by the bookmaker's de-vigged chance, not Vig's estimate: where
// the two disagree, results have followed the market, and the model leans the
// same way across many matches (under 3.5 about 1.4 points above the market,
// home wins 2 below), which made every slip lean on the same market.
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

/** About how many legs from this pool reach `target` total odds. */
function legsFor(pool: Pick[], target: number): number {
  const logs = pool.map((p) => Math.log(p.odds)).sort((a, b) => a - b);
  const mid = logs[Math.floor(logs.length / 2)] ?? 0.3;
  return Math.max(2, Math.ceil(Math.log(target) / Math.max(mid, 0.05)));
}

/** The likeliest slip near `target` odds from varied best-per-match legs in an odds band. */
function targetSlip(cands: Pick[], target: number, lo: number, hi: number, tol = 0.1): Pick[] {
  // A single leg can't make a slip, so no leg may reach the target on its own.
  const top = Math.min(hi, target * (1 - tol) - 0.01);
  const band = cands.filter((p) => p.odds >= lo && p.odds <= top);
  return byConfidence(band, (pool) => toTarget(bestPerMatch(pool, legsFor(pool, target)), target, tol, MAX_LEGS, market));
}

const STACK = ["FH_O05", "O15", "BY"];

export function cookSlates(cands: Pick[]): Slate[] {
  const out: (Slate | null)[] = [];

  // Steady: ~90% legs, as many as keep the whole slip at 60% or better.
  const safe = bestPerMatch(cands.filter((p) => market(p) >= 0.85 && p.odds >= 1.05).filter(atLeastConf("Medium")), 8);
  const steady: Pick[] = [];
  for (const p of safe) {
    if (steady.reduce((a, x) => a * market(x), 1) * market(p) < 0.6 || steady.length >= 8) break;
    steady.push(p);
  }
  if (steady.length >= 3)
    out.push(make("steady", `Steady ${word[steady.length] ?? steady.length}`,
      "Likely legs only, kept short so the whole slip lands more often than not.", steady));

  // Total-odds slips from short legs (1.25 to 2.2).
  for (const [style, target, name] of [["double", 2, "Double up"], ["fiver", 5, "Fiver"], ["tenner", 10, "Tenner"]] as const)
    out.push(make(style, name, `About ${target} odds from short, likely legs: they keep more value than one long shot.`,
      targetSlip(cands, target, 1.25, 2.2)));

  // Long odds from many likely legs, up to SportyBet's 50.
  for (const [style, target, name, lo] of [["long", 20, "Long shot", 1.15], ["hundred", 100, "Hundred", 1.2], ["thousand", 1000, "Thousand", 1.2]] as const) {
    const legs = targetSlip(cands, target, lo, 2.5, 0.15);
    if (legs.length >= 4)
      out.push(make(style, name, `About ${target.toLocaleString("en-NG")} odds from the likeliest leg per match. Every leg pays the bookmaker's cut, so slips this long land rarely; Flex shows the chance with a miss or two allowed.`, legs, true));
  }

  // Goal stack: up to 20 matches, one leg each, from the three markets that have
  // landed above the bookmaker's own prices on our logged legs so far (first half
  // over 0.5: 635 of 875 vs 609 expected; over 1.5: 653 of 869 vs 634; both teams
  // score: 530 of 981 vs 510). Not proven: none clears the false-discovery check
  // yet. A small edge per leg compounds over many legs, in either direction.
  const stackPool = cands.filter((p) => STACK.includes(p.market) && p.odds >= 1.2);
  const stack = byConfidence(stackPool, (pool) => onePerMatch(pool, market).slice(0, 20));
  if (stack.length >= 10)
    out.push(make("stack", `Goal stack ${stack.length}`, "One goals leg per match from the markets that have landed a little above the bookmaker's prices so far (not proven yet). Flex shows the chance with misses allowed.", stack, true));

  // Goals and tight games: the market and model agreeing on how the match goes.
  const goals = onePerMatch(cands.filter((p) => ["O25", "BY", "FH_O15", "O35", "H_O15", "A_O15"].includes(p.market) && market(p) >= 0.55), market);
  out.push(make("goals", "Goal rush", "Matches the bookmaker expects to be open: overs, both teams to score, a side scoring twice.",
    byConfidence(goals, (pool) => bestPerMatch(pool, 4).slice(0, 4))));
  const tight = onePerMatch(cands.filter((p) => ["U25", "BN", "FH_U15", "U15", "H_U15", "A_U15"].includes(p.market) && market(p) >= 0.55), market);
  out.push(make("tight", "Tight games", "Matches the bookmaker expects to stay low: unders, not both teams to score, a side kept quiet.",
    byConfidence(tight, (pool) => bestPerMatch(pool, 4).slice(0, 4))));

  // Bold: bigger prices only where market and model agree closely.
  const bold = bestPerMatch(cands.filter((p) => p.odds >= 1.8 && market(p) >= 0.35 && conf(p) === "High"), 3);
  if (bold.length >= 3) out.push(make("bold", `Bold ${word[3]}`, "Odds of 1.8 or more where the bookmaker and the model agree closely.", bold.slice(0, 3)));

  // Draws, with Flex chances.
  const draws = cands.filter((p) => p.market === "X" && market(p) >= 0.27).sort((a, b) => market(b) - market(a));
  if (draws.length >= 3) {
    const n = Math.min(draws.length, 4);
    out.push(make("draws", `Draw ${["", "", "pair", "trio", "four"][n]}`,
      "The likeliest draws this round. Flex in SportyBet pays a reduced amount if one or two miss.", draws.slice(0, n), true));
  }

  return (out.filter(Boolean) as Slate[])
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.chance - a.chance);
}
