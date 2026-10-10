import { readFile } from "node:fs/promises";

export type Group = {
  picks: number; settled: number; open: number; hits: number;
  expected_vig: number; expected_market: number; roi: number; roi_low: number; roi_high: number;
};
export type LegStats = { settled: number; hits: number; expected_vig: number; expected_market: number };
export type CodeGroup = {
  markets?: Record<string, LegStats>;
  codes: number; settled: number; landed: number; expected_vig: number; expected_market: number; roi: number;
  legs: { settled: number; hits: number; expected_vig: number; expected_market: number };
  recent: { code: string; user?: string; origin?: string; booked_at: number; legs: number; scored: number;
    odds: number; estimate: number; market_prob: number; won: boolean | null }[];
};
export type RecordFile = {
  version: number;
  generated_at: string;
  chain: { records: number; head: string; verified: boolean };
  grades: Record<string, Group>;
  confidence?: Record<string, Group>;
  ourpicks?: Group;
  mycodes?: CodeGroup & { by_user?: Record<string, CodeGroup> };
  slates?: CodeGroup & { by_style?: Record<string, CodeGroup> };
  markets: (Group & { market: string; grade: string })[];
  curve: Record<string, [string, number][]>;
  calibration: { bin: string; n: number; estimate: number; market: number; hit_rate: number }[];
  recent: {
    kickoff: string | null; fixture: string; market: string; odds: number; estimate: number;
    market_prob: number; grade: string; generated_at?: string; won: boolean | null; score: string | null;
  }[];
};

export const RECORD_URL =
  process.env.RECORD_URL ?? "https://raw.githubusercontent.com/gadjacobs/vigs/data/record.json";

let cached: { at: number; rec: RecordFile } | null = null;

/** The ledger scorecard the collector publishes hourly. Cached for 5 minutes. */
export async function loadRecord(): Promise<RecordFile> {
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.rec;
  let rec: RecordFile;
  if (process.env.RECORD_PATH) {
    rec = JSON.parse(await readFile(process.env.RECORD_PATH, "utf8"));
  } else {
    const res = await fetch(RECORD_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`record file: HTTP ${res.status}`);
    rec = (await res.json()) as RecordFile;
  }
  cached = { at: Date.now(), rec };
  return rec;
}
