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

/** Codes on this device still to play or in play, for the tab bar's counter. */
export function openCount(now = Date.now()): number {
  const done = readFinal();
  return readCodes().filter((c) => !done[c.code] && c.last + 3 * 3600_000 > now).length;
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

