import { describe, expect, it } from "vitest";
import { dailyNet, lagosDay, lagosMonth, lagosWeek, mergeMoney, settleEntry, slipReturn, tally, todayAgainst, type MoneyEntry } from "../lib/money";
import { multiBonus } from "../lib/bonus";

const NOW = Date.UTC(2026, 10, 2, 12); // Mon 2 Nov 2026, 13:00 Lagos
const e = (code: string, at: number, stake: number, back: number | null, edited = at): MoneyEntry => ({ code, at, stake, back, edited });

describe("my money", () => {
  it("merges devices by the latest edit", () => {
    const a = [e("AAAA11", NOW, 1000, null, NOW)];
    const b = [e("AAAA11", NOW, 2000, null, NOW + 5), e("BBBB22", NOW - 1, 500, 0)];
    const m = mergeMoney(a, b, NOW);
    expect(m.map((x) => [x.code, x.stake])).toEqual([["AAAA11", 2000], ["BBBB22", 500]]);
    expect(mergeMoney([e("bad", NOW, 1, null)], [], NOW)).toEqual([]);
    expect(mergeMoney([e("OLD111", NOW - 200 * 86_400_000, 1, null)], [], NOW)).toEqual([]);
  });
  it("pays a landed slip its odds with the multi-bet bonus, a lost one nothing", () => {
    const odds = [1.5, 1.5, 1.5, 1.5, 1.5];
    const per = slipReturn(odds);
    expect(per).toBeCloseTo(multiBonus(odds.map((o) => ({ odds: o, p: 1 / (o * 1.04) }))).totalOdds, 9);
    expect(per).toBeGreaterThan(1.5 ** 5);
    expect(settleEntry(e("AAAA11", NOW, 1000, null), "won", odds, NOW).back).toBe(Math.round(1000 * per));
    expect(settleEntry(e("AAAA11", NOW, 1000, null), "lost", odds, NOW).back).toBe(0);
    // A typed-in amount (Flex, cash-out) stays.
    expect(settleEntry({ ...e("AAAA11", NOW, 1000, 300), manual: true }, "lost", odds, NOW).back).toBe(300);
  });
  it("counts days, weeks and months in Lagos", () => {
    expect(lagosDay(NOW)).toBe(Date.UTC(2026, 10, 1, 23));
    expect(lagosWeek(NOW)).toBe(Date.UTC(2026, 10, 1, 23)); // Monday
    expect(lagosWeek(NOW + 3 * 86_400_000)).toBe(Date.UTC(2026, 10, 1, 23));
    expect(lagosMonth(NOW)).toBe(Date.UTC(2026, 9, 31, 23));
  });
  it("tallies staked, paid back and net, open stakes kept apart", () => {
    const list = [e("AAAA11", NOW, 1000, 5000), e("BBBB22", NOW, 1000, 0), e("CCCC33", NOW, 500, null), e("DDDD44", NOW, 0, null)];
    expect(tally(list, lagosDay(NOW))).toEqual({ staked: 2500, back: 5000, net: 3000, open: 500, codes: 3, won: 1, best: 4000 });
    expect(dailyNet(list, NOW).at(-1)).toEqual({ day: lagosDay(NOW), net: 3000 });
    expect(todayAgainst(list, 2000, NOW)).toEqual({ staked: 2500, left: 0, over: true });
    expect(todayAgainst(list, 0, NOW).left).toBeNull();
  });
});
