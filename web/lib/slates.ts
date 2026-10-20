import { atLeast } from "./flex";
import type { LeanRow } from "./insights";
import { marketsAtOrAbove } from "./lean";
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

// Kick-off windows tried, nearest first (minutes after the first bookable kick-off).
const WINDOWS = [0, 10, 30, 60, 120, 240];
// A wider window is used only when it makes the slip at least this much likelier.
const WIDER_GAIN = 1.05;

/**
 * The likeliest slip near `target` odds from legs in an odds band, as close
 * together as the round allows. Any market of a match may be used (one leg per
 * match). Replayed over 985 cooks (9-20 Oct), taking the next round's matches
 * alone gave the Double up a 52.7% priced chance against 51.4% for the old
 * rule (each match's single likeliest leg over four hours, 76 min between
 * first and last kick-off); Tenner and the 20-odds slip priced the same, with
 * every leg in one round instead of two hours apart. Later rounds join only
 * when they lift the chance by 5% or more.
 */
function targetSlip(cands: Pick[], target: number, lo: number, hi: number, tol = 0.1): Pick[] {
  // A single leg can't make a slip, so no leg may reach the target on its own.
  const top = Math.min(hi, target * (1 - tol) - 0.01);
  const band = cands.filter((p) => p.odds >= lo && p.odds <= top);
  if (!band.length) return [];
  const first = Math.min(...band.map((p) => p.kickoff));
  let best: Pick[] = [], bestP = 0;
  for (const w of WINDOWS) {
    const pool = band.filter((p) => p.kickoff <= first + w * 60_000);
    const legs = byConfidence(pool, (ps) => toTarget(ps, target, tol, MAX_LEGS, market));
    if (legs.length < 2) continue;
    const p = legs.reduce((a, x) => a * market(x), 1);
    if (!best.length || p >= bestP * WIDER_GAIN) { best = legs; bestP = p; }
  }
  return best;
}

const STACK = ["FH_O05", "O15", "BY"];
const UNDER = /^(FH_|H_|A_)?U\d\d$/;
const TIGHT = ["H_U15", "FH_U15", "U25"];

export function cookSlates(cands: Pick[], lean?: LeanRow[]): Slate[] {
  const out: (Slate | null)[] = [];

  // Steady: ~90% legs, as many as keep the whole slip at 60% or better, from the
  // markets whose record at 85%+ is at or above their price in our data (the
  // hourly `lean` in insights.json; unders, lately). Without that record, under
  // lines only: on 6,898 matches (9-13 Oct) unders priced at 85% or more landed
  // 90.7% against 89.8% priced (19,588 selections, z = 4.2).
  const steadyOk = marketsAtOrAbove(lean, 0.85, 1.0001);
  const safe = bestPerMatch(cands.filter((p) => (steadyOk ? steadyOk.has(p.market) : UNDER.test(p.market))
    && market(p) >= 0.85 && p.odds >= 1.05).filter(atLeastConf("Medium")), 8);
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
  // Tight games: low-scoring lines (unders, not both teams to score) whose record
  // at 55-85% is at or above their price in our data (home under 1.5 has led:
  // 67.0% vs 65.1% on 5,227, the one market there to pass the false-discovery
  // check). Without that record: home under 1.5, first half under 1.5, under 2.5.
  const tightOk = marketsAtOrAbove(lean, 0.55, 0.85);
  const tightMarkets = (m: string) => (tightOk && [...tightOk].some((x) => UNDER.test(x) || x === "BN")
    ? tightOk.has(m) && (UNDER.test(m) || m === "BN") : TIGHT.includes(m));
  const tight = onePerMatch(cands.filter((p) => tightMarkets(p.market) && market(p) >= 0.55), market);
  out.push(make("tight", "Tight games", "Matches the bookmaker expects to stay low: unders, and a home side kept to one goal or fewer.",
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
