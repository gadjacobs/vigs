import type { SlipWatch } from "./watches";

// Pure rules for slip alerts, shared by the server and the alert form.

/** Why an alert's conditions can never all be met together, or null. A slip's
 * chance times its odds is what it pays back per 1 staked, which the bookmaker's
 * cut keeps under 1: a slip at 50 odds lands at most about 2% of the time. */
export function impossible(w: Pick<SlipWatch, "minChance" | "minOdds">): string | null {
  if (!w.minChance || !w.minOdds || w.minChance * w.minOdds <= 1) return null;
  const most = 1 / w.minOdds;
  return `A slip at ${w.minOdds}+ odds lands at most about ${most >= 0.1 ? Math.round(most * 100) : Math.round(most * 1000) / 10}% of the time, so it can't also land ${Math.round(w.minChance * 100)}%+ as a whole. To ask for likely legs, use "Each leg lands, at least".`;
}

