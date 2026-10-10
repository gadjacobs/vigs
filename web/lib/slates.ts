import { atLeast } from "./flex";
import { ourPicks } from "./ourpicks";
import type { Pick } from "./picks";
import { confidence, slipConfidence, type Confidence } from "./plain";
import { toTarget } from "./slip";

// Cooked slips: ready-made, named slips for the rounds published right now.
// Which slips appear, and how many legs each has, depends on what the round
// offers: a slip is only cooked when enough legs clear its confidence bar.
// Built on the data so far (see Record, "What the data says"): short prices
// keep value, long shots lose it; market and model agreeing is what
// confidence measures; draws are priced per league and land about 1 in 4.

export type StyleId = "steady" | "double" | "fiver" | "tenner" | "goals" | "tight" | "bold" | "draws";
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
    flex: flex ? [0, 1, 2].filter((m) => n - m >= 1).map((m) => ({ need: n - m, chance: atLeast(ps, n - m) })) : undefined,
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

export function cookSlates(cands: Pick[]): Slate[] {
  const out: (Slate | null)[] = [];

  // Steady: ~90% legs, as many as keep the whole slip at 60% or better.
  const safe = ourPicks(cands, 0.88).filter(atLeastConf("Medium")).sort((a, b) => b.estimate - a.estimate);
  const steady: Pick[] = [];
  for (const p of safe) {
    if (steady.reduce((a, x) => a * x.estimate, 1) * p.estimate < 0.6 || steady.length >= 8) break;
    steady.push(p);
  }
  if (steady.length >= 3)
    out.push(make("steady", `Steady ${word[steady.length] ?? steady.length}`,
      "Likely legs only, kept short so the whole slip lands more often than not.", steady));

  // Total-odds slips from short legs (1.25 to 2.2).
  const short = cands.filter((p) => p.odds >= 1.25 && p.odds <= 2.2);
  for (const [style, target, name] of [["double", 2, "Double up"], ["fiver", 5, "Fiver"], ["tenner", 10, "Tenner"]] as const) {
    const legs = byConfidence(short, (pool) => toTarget(pool, target, 0.1, 10));
    out.push(make(style, name, `About ${target} odds from short, likely legs: they keep more value than one long shot.`, legs));
  }

  // Goals and tight games: the market and model agreeing on how the match goes.
  const goals = onePerMatch(cands.filter((p) => ["O25", "BY", "FH_O15", "O35"].includes(p.market) && p.estimate >= 0.55), (p) => p.estimate);
  out.push(make("goals", "Goal rush", "Matches the market and model both expect to be open: overs and both teams to score.",
    byConfidence(goals, (pool) => pool.slice(0, 4))));
  const tight = onePerMatch(cands.filter((p) => ["U25", "BN", "FH_U15", "U15"].includes(p.market) && p.estimate >= 0.55), (p) => p.estimate);
  out.push(make("tight", "Tight games", "Matches both expect to stay low: unders and not both teams to score.",
    byConfidence(tight, (pool) => pool.slice(0, 4))));

  // Bold: bigger prices only where market and model agree closely.
  const bold = onePerMatch(cands.filter((p) => p.odds >= 1.8 && p.estimate >= 0.35 && conf(p) === "High"), (p) => p.estimate);
  if (bold.length >= 3) out.push(make("bold", `Bold ${word[3]}`, "Odds of 1.8 or more where the bookmaker and the model agree closely.", bold.slice(0, 3)));

  // Draws, with Flex chances.
  const draws = cands.filter((p) => p.market === "X" && p.estimate >= 0.27).sort((a, b) => b.estimate - a.estimate);
  if (draws.length >= 3) {
    const n = Math.min(draws.length, 4);
    out.push(make("draws", `Draw ${["", "", "pair", "trio", "four"][n]}`,
      "The likeliest draws this round. Flex in SportyBet pays a reduced amount if one or two miss.", draws.slice(0, n), true));
  }

  return (out.filter(Boolean) as Slate[])
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.chance - a.chance);
}
