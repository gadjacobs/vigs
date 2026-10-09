import { readFile } from "node:fs/promises";

// Mirrors vigs/blend.py: P = sigmoid(a + b1 * logit(market chance) + b2 * logit(model)).
export type BlendMarket = {
  active: boolean;
  reason: string;
  n_rows: number;
  coef?: [number, number, number];
  reps?: [number, number, number][];
  test?: { n: number; market: number; model: number; blend: number };
};
export type BlendFile = {
  version: number;
  min_matches: number;
  matches: number;
  generated_at: string;
  markets: Record<string, BlendMarket>;
};

const EPS = 1e-6;
const logit = (p: number) => {
  const x = Math.min(Math.max(p, EPS), 1 - EPS);
  return Math.log(x / (1 - x));
};
const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

export function applyBlend(coef: [number, number, number], q: number, p: number): number {
  return sigmoid(coef[0] + coef[1] * logit(q) + coef[2] * logit(p));
}

/** Blended estimate and 90% range when active for `market`; null means use the model. */
export function blendEstimate(
  blend: BlendFile | null, market: string, q: number, pMain: number, pReps: number[],
): { p: number; lo: number; hi: number } | null {
  const e = blend?.markets[market];
  if (!e?.active || !e.coef) return null;
  const main = applyBlend(e.coef, q, pMain);
  const coefs = e.reps?.length ? e.reps : [e.coef];
  const ps = pReps.length ? pReps : [pMain];
  const n = Math.min(coefs.length, ps.length);
  const draws = Array.from({ length: n }, (_, i) => applyBlend(coefs[i], q, ps[i])).sort((a, b) => a - b);
  const lo = draws[Math.floor(0.05 * (n - 1))];
  const hi = draws[Math.ceil(0.95 * (n - 1))];
  return { p: main, lo: Math.min(lo, main), hi: Math.max(hi, main) };
}

export const BLEND_URL =
  process.env.BLEND_URL ?? "https://raw.githubusercontent.com/gadjacobs/vigs/data/blend.json";

let cached: { at: number; blend: BlendFile | null } | null = null;

/** The blend the collector publishes hourly; null until the first one exists. */
export async function loadBlend(): Promise<BlendFile | null> {
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.blend;
  let blend: BlendFile | null = null;
  try {
    if (process.env.BLEND_PATH) blend = JSON.parse(await readFile(process.env.BLEND_PATH, "utf8"));
    else {
      const res = await fetch(BLEND_URL, { cache: "no-store" });
      if (res.ok) blend = (await res.json()) as BlendFile;
    }
  } catch {
    blend = null;
  }
  cached = { at: Date.now(), blend };
  return blend;
}
