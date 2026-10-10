import { readFile } from "node:fs/promises";

// What the collected data says (vigs/insights.py), published hourly.
export type Insights = {
  version: number; generated_at: string; matches_with_odds: number; results: number; results_from: string | null;
  margins: { family: string; margin: number; n: number }[];
  bands: { lo: number; hi: number; n: number; landed: number; market: number; break_even: number; roi: number; se: number }[];
  leagues: { league: string; n: number; goals: number; home: number; draw: number; away: number; nil_nil: number; btts: number; first_half_share: number }[];
};

export const INSIGHTS_URL =
  process.env.INSIGHTS_URL ?? "https://raw.githubusercontent.com/gadjacobs/vigs/data/insights.json";

let cached: { at: number; v: Insights | null } | null = null;

export async function loadInsights(): Promise<Insights | null> {
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.v;
  let v: Insights | null = null;
  try {
    if (process.env.INSIGHTS_PATH) v = JSON.parse(await readFile(process.env.INSIGHTS_PATH, "utf8"));
    else {
      const res = await fetch(INSIGHTS_URL, { cache: "no-store" });
      if (res.ok) v = (await res.json()) as Insights;
    }
  } catch {
    v = null;
  }
  cached = { at: Date.now(), v };
  return v;
}
