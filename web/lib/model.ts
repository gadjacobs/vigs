import { readFile } from "node:fs/promises";
import { probs } from "./poisson";

export type LeagueParams = {
  home: number;
  fh_share: number;
  attack: Record<string, number>;
  defence: Record<string, number>;
};
export type Hist = { n: number } & Record<string, number>;
export type ModelFile = {
  version: number;
  fitted_on: number;
  from: string;
  to: string;
  exported_at?: string;
  window_days?: number;
  leagues: Record<string, LeagueParams & { reps: LeagueParams[] }>;
  history: Record<string, Record<string, { home?: Hist; away?: Hist }>>;
};

export const MODEL_URL =
  process.env.MODEL_URL ?? "https://raw.githubusercontent.com/gadjacobs/vigs/data/model.json";

let cached: { at: number; model: ModelFile } | null = null;

/** The model the collector publishes hourly. Cached in memory for 10 minutes. */
export async function loadModel(): Promise<ModelFile> {
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.model;
  let model: ModelFile;
  if (process.env.MODEL_PATH) {
    model = JSON.parse(await readFile(process.env.MODEL_PATH, "utf8"));
  } else {
    const res = await fetch(MODEL_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`model file: HTTP ${res.status}`);
    model = (await res.json()) as ModelFile;
  }
  cached = { at: Date.now(), model };
  return model;
}

function predict(p: LeagueParams, home: string, away: string): Record<string, number> | null {
  if (!(home in p.attack) || !(away in p.attack)) return null;
  const lh = p.home * p.attack[home] * p.defence[away];
  const la = p.attack[away] * p.defence[home];
  return probs(lh, la, p.fh_share);
}

/** Model estimate with a 90% interval from the bootstrap refits. */
export function estimate(
  model: ModelFile,
  league: string,
  home: string,
  away: string,
  market: string,
): { p: number; lo: number; hi: number } | null {
  const lg = model.leagues[league];
  const main = lg && predict(lg, home, away);
  if (!main || !(market in main)) return null;
  const draws = lg.reps
    .map((r) => predict(r, home, away)?.[market])
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);
  if (!draws.length) return { p: main[market], lo: main[market], hi: main[market] };
  const n = draws.length - 1;
  return { p: main[market], lo: draws[Math.floor(0.05 * n)], hi: draws[Math.ceil(0.95 * n)] };
}

/** This market in the home side's home games plus the away side's away games. */
export function history(
  model: ModelFile,
  league: string,
  home: string,
  away: string,
  market: string,
): { rate: number | null; n: number } {
  const h = model.history[league]?.[home]?.home;
  const a = model.history[league]?.[away]?.away;
  const n = (h?.n ?? 0) + (a?.n ?? 0);
  const hits = (h?.[market] ?? 0) + (a?.[market] ?? 0);
  return { rate: n ? hits / n : null, n };
}
