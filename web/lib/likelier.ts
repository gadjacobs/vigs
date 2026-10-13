// The likeliest slip for a payout: a port of vigs.odds.likeliest_slip (pinned by
// tests/slip-search.test.ts). Market chance is calibrated on our data, so at a
// given total price a slip's chance is set by how much of the stake the bookmaker
// keeps, compounded once per leg. Legs priced 1.5 to 5 keep the most per unit of
// odds they add; see vigs/odds.py for the numbers.
import { fairProbs } from "./markets";
import type { Fixture } from "./sportybet";

export const LEG_RANGE: [number, number] = [1.5, 5.0];
const STEP = 0.005; // log-odds resolution of the search
const SLACK = 0.10; // how far above the target the total may land, in log-odds

export type Option = { market: string; odds: number; chance: number };
export type SearchMatch = { id: string; options: Option[] };
export type Chosen = { id: string; market: string; odds: number; chance: number };

const bucket = (x: number) => Math.floor(x / STEP + 0.5);

/** At most one selection per match, total odds at least about `target`, with the
 * highest product of chances. Exact over the search grid. */
export function likeliestSlip(matches: SearchMatch[], target: number, lo = LEG_RANGE[0], hi = LEG_RANGE[1], slack = SLACK): Chosen[] {
  if (!(target > 1)) return [];
  const top = bucket(Math.log(target) + slack);
  const need = Math.floor(Math.log(target) / STEP);
  let best = new Float64Array(top + 1).fill(-Infinity);
  best[0] = 0;
  const stages: { id: string; opts: (Option & { k: number; lp: number })[]; choice: Int16Array }[] = [];
  for (const m of matches) {
    const opts = m.options
      .filter((o) => o.odds >= lo && o.odds <= hi && o.chance > 0 && o.chance < 1)
      .map((o) => ({ ...o, k: bucket(Math.log(o.odds)), lp: Math.log(o.chance) }));
    const next = best.slice();
    const choice = new Int16Array(top + 1).fill(-1);
    for (let b = 0; b <= top; b++) {
      const v0 = best[b];
      if (v0 === -Infinity) continue;
      for (let j = 0; j < opts.length; j++) {
        const nb = b + opts[j].k;
        if (nb <= top && v0 + opts[j].lp > next[nb]) {
          next[nb] = v0 + opts[j].lp;
          choice[nb] = j;
        }
      }
    }
    stages.push({ id: m.id, opts, choice });
    best = next;
  }
  let end = -1;
  for (let b = need; b <= top; b++) if (best[b] > -Infinity && (end < 0 || best[b] > best[end])) end = b;
  if (end < 0) return [];
  const out: Chosen[] = [];
  for (let i = stages.length - 1; i >= 0; i--) {
    const j = stages[i].choice[end];
    if (j >= 0) {
      const o = stages[i].opts[j];
      out.push({ id: stages[i].id, market: o.market, odds: o.odds, chance: o.chance });
      end -= o.k;
    }
  }
  return out.reverse();
}

export type Rule = "any" | "goals" | "nodraw";
const allowed = (rule: Rule, market: string) =>
  rule === "goals" ? !/^(1|X|2|DC1X|DC12|DCX2)$/.test(market) : rule === "nodraw" ? market !== "X" : true;

/** Every priced selection of each fixture, with its market chance (Shin de-vig). */
export function searchPool(fixtures: Fixture[], rule: Rule = "any"): SearchMatch[] {
  return [...fixtures]
    .sort((a, b) => a.kickoff - b.kickoff || a.eventId.localeCompare(b.eventId))
    .map((f) => {
      const fair = fairProbs(f.odds);
      return {
        id: f.eventId,
        options: Object.keys(fair).filter((m) => f.odds[m] && allowed(rule, m)).sort()
          .map((m) => ({ market: m, odds: f.odds[m], chance: fair[m] })),
      };
    });
}

export type Slip = { legs: (Chosen & { fixture: Fixture })[]; odds: number; chance: number; keeps: number };

/** The likeliest slip from these fixtures at this payout, with its totals. */
export function bestSlip(fixtures: Fixture[], target: number, rule: Rule = "any"): Slip | null {
  const by = new Map(fixtures.map((f) => [f.eventId, f]));
  const legs = likeliestSlip(searchPool(fixtures, rule), target).map((c) => ({ ...c, fixture: by.get(c.id)! }));
  if (!legs.length) return null;
  const odds = legs.reduce((a, l) => a * l.odds, 1), chance = legs.reduce((a, l) => a * l.chance, 1);
  return { legs, odds, chance, keeps: odds * chance };
}
