// My money on this device (localStorage), synced with the account's profile.
import type { MoneyEntry } from "@/lib/money";

export const MONEY_KEY = "vig_money";
export const LIMIT_KEY = "vig_limit";

export function readMoney(): MoneyEntry[] {
  try { return JSON.parse(localStorage.getItem(MONEY_KEY) ?? "[]") as MoneyEntry[]; } catch { return []; }
}
export function writeMoney(list: MoneyEntry[]) {
  try { localStorage.setItem(MONEY_KEY, JSON.stringify(list.slice(0, 600))); } catch { /* full or private */ }
  window.dispatchEvent(new Event("vig-money"));
}
export function readLimit(): number {
  try { return Number(localStorage.getItem(LIMIT_KEY) ?? 0) || 0; } catch { return 0; }
}
export function writeLimit(n: number) {
  try { localStorage.setItem(LIMIT_KEY, String(n)); } catch { /* private mode */ }
  window.dispatchEvent(new Event("vig-money"));
}
/** Add or change one code's entry. */
export function putEntry(e: MoneyEntry) {
  writeMoney([e, ...readMoney().filter((x) => x.code !== e.code)]);
}
