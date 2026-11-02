import { chanceAtOdds, multiBonus } from "./bonus";

// My money: what you staked on each code and what it paid back, entered by you
// (Vig never sees your SportyBet account). Pure, so the server merge, the Codes
// panel and the tests share it.

export type MoneyEntry = {
  code: string;
  at: number;            // when the code was booked or tracked (its day counts toward the daily limit)
  stake: number;         // ₦ staked; 0 = removed (kept so other devices drop it too)
  back: number | null;   // ₦ paid back once settled; null while open
  manual?: boolean;      // `back` typed in (Flex, cash-out), so settling never overwrites it
  pot?: number;          // SportyBet's "Pot. Win" as typed in: the exact payout if it lands, bonus included
  edited: number;        // last change, for merging devices
};

const KEEP_DAYS = 120;
const MAX = 600;
const LAGOS = 3600_000; // UTC+1

export const naira = (x: number) => `₦${Math.round(Math.abs(x)).toLocaleString("en-NG")}`;
export const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${naira(x)}`;

/** Union of two lists by code, the latest edit winning, without old or excess entries. */
export function mergeMoney(a: MoneyEntry[], b: MoneyEntry[], now = Date.now()): MoneyEntry[] {
  const by = new Map<string, MoneyEntry>();
  for (const e of [...a, ...b]) {
    if (!e || !/^[A-Z0-9]{4,12}$/.test(e.code) || !(e.at > now - KEEP_DAYS * 86_400_000)) continue;
    const stake = Math.min(10_000_000, Math.max(0, Math.round(+e.stake || 0)));
    const back = e.back === null || e.back === undefined ? null : Math.min(1e10, Math.max(0, Math.round(+e.back || 0)));
    const pot = Math.min(1e10, Math.max(0, Math.round(+(e.pot ?? 0) || 0)));
    const clean: MoneyEntry = { code: e.code, at: +e.at, stake, back, edited: +e.edited || 0, ...(e.manual ? { manual: true } : {}), ...(pot > stake ? { pot } : {}) };
    const old = by.get(e.code);
    if (!old || clean.edited > old.edited) by.set(e.code, clean);
  }
  return [...by.values()].sort((x, y) => y.at - x.at).slice(0, MAX);
}

/** What a straight slip pays per ₦1 when every leg lands, SportyBet's multi-bet bonus included.
 * The bonus is worked out from the legs' prices, with what SportyBet's chances pay back at those odds standing in for them (lib/bonus.ts `legPayback`), as on the card. */
export function slipReturn(legOdds: number[]): number {
  if (!legOdds.length || legOdds.some((o) => !(o > 1))) return legOdds.reduce((a, o) => a * (o || 1), 1);
  return multiBonus(legOdds.map((o) => ({ odds: o, p: chanceAtOdds(o) }))).totalOdds;
}

/** What a stake pays if the slip lands: SportyBet's own Pot. Win when the user typed it in,
 * else the stake × the odds with the bonus as Vig works it out (an estimate). */
export const potentialWin = (e: Pick<MoneyEntry, "stake" | "pot">, legOdds: number[]): number =>
  e.pot && e.pot > e.stake ? e.pot : e.stake * slipReturn(legOdds);

/** The multi-bet bonus ratio SportyBet applied, from its Pot. Win: the extra over the plain odds
 * divided by the combined odds of the legs that qualify (1.20 or more). Null when it can't be told. */
export function impliedBonus(stake: number, pot: number, legOdds: number[]): number | null {
  if (!(stake > 0) || !(pot > stake) || !legOdds.length || legOdds.some((o) => !(o > 1))) return null;
  const all = legOdds.reduce((a, o) => a * o, 1);
  const q = legOdds.filter((o) => o >= 1.2).reduce((a, o) => a * o, 1);
  const extra = pot / stake - all;
  return q > 1 && extra > 0 ? extra / q : null;
}

/** An entry once its code is decided: a landed code pays its Pot. Win (SportyBet's if typed in, else
 * stake × odds with the bonus), a lost one 0. Typed-in amounts stay. */
export function settleEntry(e: MoneyEntry, state: "won" | "lost", legOdds: number[], now = Date.now()): MoneyEntry {
  if (e.manual || e.back !== null) return e;
  return { ...e, back: state === "won" ? Math.round(potentialWin(e, legOdds)) : 0, edited: now };
}

/** Midnight in Lagos at or before `t`. */
export const lagosDay = (t: number) => Math.floor((t + LAGOS) / 86_400_000) * 86_400_000 - LAGOS;

/** Monday 00:00 Lagos of the week holding `t`. */
export function lagosWeek(t: number): number {
  const d = lagosDay(t);
  const dow = (new Date(d + LAGOS).getUTCDay() + 6) % 7; // Monday 0
  return d - dow * 86_400_000;
}

/** The first of the month in Lagos holding `t`. */
export function lagosMonth(t: number): number {
  const x = new Date(t + LAGOS);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) - LAGOS;
}

export type Tally = { staked: number; back: number; net: number; open: number; codes: number; won: number; best: number };

/** Staked, paid back and net from `from` on; open stakes count as staked but not yet in net. */
export function tally(list: MoneyEntry[], from: number, to = Infinity): Tally {
  const t: Tally = { staked: 0, back: 0, net: 0, open: 0, codes: 0, won: 0, best: 0 };
  for (const e of list) {
    if (!e.stake || e.at < from || e.at >= to) continue;
    t.codes++;
    t.staked += e.stake;
    if (e.back === null) { t.open += e.stake; continue; }
    t.back += e.back;
    t.net += e.back - e.stake;
    if (e.back > 0) { t.won++; t.best = Math.max(t.best, e.back - e.stake); }
  }
  return t;
}

/** Net per Lagos day for the last `days` days (oldest first); open stakes left out. */
export function dailyNet(list: MoneyEntry[], now: number, days = 7): { day: number; net: number }[] {
  const today = lagosDay(now);
  return Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i) * 86_400_000;
    return { day, net: tally(list, day, day + 86_400_000).net };
  });
}

/** Staked today (Lagos) and how it stands against a daily limit (0 = none). */
export function todayAgainst(list: MoneyEntry[], limit: number, now = Date.now()): { staked: number; left: number | null; over: boolean } {
  const staked = tally(list, lagosDay(now), lagosDay(now) + 86_400_000).staked;
  if (!limit) return { staked, left: null, over: false };
  return { staked, left: Math.max(0, limit - staked), over: staked >= limit };
}
