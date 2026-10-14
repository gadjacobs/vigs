// Codes kept on this device (localStorage): the list, settled results and
// removed codes. Small and dependency-free so the tab bar can count open codes.
import type { Tracked } from "@/lib/codes";
import type { SavedCode as Saved } from "@/lib/profile";

export const CODES_KEY = "vig_codes";

export function readAll(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(CODES_KEY) ?? "[]") as Saved[];
  } catch {
    return [];
  }
}

export function writeAll(list: Saved[]) {
  try {
    localStorage.setItem(CODES_KEY, JSON.stringify(list.slice(0, 60)));
  } catch { /* private mode */ }
}

/** A code that can't change any more: landed, every leg decided, long past its
 * last kick-off, or outside vFootball. A lost code with legs still to play stays
 * live, since a slip played with Flex can still pay. */
export function isFinal(t: Tracked, now = Date.now()): boolean {
  return t.foreign || t.state === "won" || t.legs.every((l) => l.status === "won" || l.status === "lost")
    || t.lastKickoff + 3 * 3600_000 < now;
}

export const FINAL_KEY = "vig_code_final";
export function readFinal(): Record<string, Tracked> {
  try {
    return JSON.parse(localStorage.getItem(FINAL_KEY) ?? "{}") as Record<string, Tracked>;
  } catch {
    return {};
  }
}
export function saveFinal(ts: Tracked[]) {
  if (!ts.length) return;
  const all = { ...readFinal(), ...Object.fromEntries(ts.map((t) => [t.code, t])) };
  const keep = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].lastKickoff - a[1].lastKickoff).slice(0, 80));
  try { localStorage.setItem(FINAL_KEY, JSON.stringify(keep)); } catch { /* full or private */ }
  window.dispatchEvent(new Event("vig-codes"));
}

// The last reading of each open code, shown at once on the next visit (marked as
// updating) while SportyBet is read again.
export const OPEN_KEY = "vig_code_open";
export function readOpen(now = Date.now()): Record<string, Tracked> {
  try {
    const all = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, Tracked>;
    return Object.fromEntries(Object.entries(all).filter(([, t]) => t.lastKickoff + 6 * 3600_000 > now));
  } catch {
    return {};
  }
}
export function saveOpen(ts: Tracked[]) {
  const all = { ...readOpen(), ...Object.fromEntries(ts.map((t) => [t.code, t])) };
  for (const t of ts) if (isFinal(t)) delete all[t.code];
  const keep = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].lastKickoff - a[1].lastKickoff).slice(0, 40));
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(keep)); } catch { /* full or private */ }
}

/** Codes on this device still to play or in play, for the tab bar's counter. */
export function openCount(now = Date.now()): number {
  const done = readFinal(), seen = readOpen(now);
  return readCodes().filter((c) => !done[c.code] && seen[c.code]?.state !== "lost" && c.last + 3 * 3600_000 > now).length;
}

export const HIDDEN_KEY = "vig_codes_hidden";
export function readHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function writeHidden(h: Set<string>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...h].slice(-300))); } catch { /* private mode */ }
}

/** Every code on this device except removed ones, newest first. */
export const readCodes = (): Saved[] => {
  const hidden = readHidden();
  return readAll().filter((c) => !hidden.has(c.code)).sort((a, b) => b.at - a.at);
};

