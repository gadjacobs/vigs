// The Codes tab's two hot reads, as plain requests (they run side by side;
// server actions queue one behind another).
import type { Tracked } from "@/lib/codes";
import type { LegRef, LiveLeg } from "@/lib/live";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const trackCodes = (codes: string[]) => post<(Tracked | { code: string; error: string })[]>("/api/codes/track", { codes });
export const liveCodes = (legs: LegRef[]) => post<Record<string, LiveLeg>>("/api/codes/live", { legs });
