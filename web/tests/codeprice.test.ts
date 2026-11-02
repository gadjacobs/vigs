import { describe, expect, it } from "vitest";
import { priceLeg } from "../lib/codes";
import { impliedBonus, mergeMoney, potentialWin, settleEntry, slipReturn, type MoneyEntry } from "../lib/money";

const NOW = Date.UTC(2026, 10, 2, 19, 30); // 20:30 Lagos
const KO = NOW + 16 * 60_000;

describe("pricing a leg of a loaded code", () => {
  it("keeps the prematch price for a leg Vig saw before kickoff, even once it is in play", () => {
    expect(priceLeg({ prematch: 1.5, shareOdds: 1.22, kickoff: NOW - 60_000, now: NOW, playing: true })).toEqual({ odds: 1.5, live: false });
  });
  it("takes the share endpoint's price before kickoff as the prematch price", () => {
    expect(priceLeg({ shareOdds: 1.4, kickoff: KO, now: NOW, playing: false })).toEqual({ odds: 1.4, live: false });
  });
  it("prices a leg already in play when first loaded at its live price", () => {
    expect(priceLeg({ shareOdds: 1.22, kickoff: NOW - 60_000, now: NOW, playing: true })).toEqual({ odds: 1.22, live: true });
  });
  it("keeps the live price captured at first load, however the match moves on", () => {
    expect(priceLeg({ seen: 1.22, shareOdds: 1.05, kickoff: NOW - 600_000, now: NOW, playing: true })).toEqual({ odds: 1.22, live: true });
  });
  it("never prices an ended leg from the share endpoint", () => {
    expect(priceLeg({ shareOdds: 1.01, kickoff: NOW - 3_600_000, now: NOW, playing: false })).toEqual({ odds: null, live: false });
  });
  it("ignores a price of 1 or less", () => {
    expect(priceLeg({ shareOdds: 0, kickoff: KO, now: NOW, playing: false }).odds).toBeNull();
    expect(priceLeg({ shareOdds: 1, kickoff: NOW - 1000, now: NOW, playing: true }).odds).toBeNull();
  });
});

describe("SportyBet's Pot. Win", () => {
  // 11 legs whose odds multiply to 7.94: the slip on the Vig and SportyBet screens of 2 Nov 2026.
  const legs = Array.from({ length: 11 }, () => 7.94 ** (1 / 11));
  const e = (stake: number, pot?: number): MoneyEntry => ({ code: "WP7AHU", at: NOW, stake, back: null, edited: NOW, ...(pot ? { pot } : {}) });

  it("reads the bonus SportyBet applied (+25%, where Vig's estimate said +35%)", () => {
    const r = impliedBonus(2030, 20146.66, legs);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.25, 2);
    // The estimate caps at +35% for 11 legs: ₦2,000 would show about ₦21,438.
    expect(2000 * slipReturn(legs)).toBeCloseTo(21438, -1);
  });
  it("can't be read without prices, or from a pot that is no more than the stake", () => {
    expect(impliedBonus(2030, 20146.66, [])).toBeNull();
    expect(impliedBonus(2030, 2030, legs)).toBeNull();
    expect(impliedBonus(2030, 20146.66, [1.5, 0])).toBeNull();
  });
  it("shows SportyBet's figure when typed, the estimate otherwise", () => {
    expect(potentialWin(e(2030, 20146.66), legs)).toBe(20146.66);
    expect(potentialWin(e(2030), legs)).toBeCloseTo(2030 * slipReturn(legs), 6);
  });
  it("settles a landed code at its Pot. Win", () => {
    expect(settleEntry(e(2030, 20146.66), "won", legs, NOW).back).toBe(20147);
    expect(settleEntry(e(2030, 20146.66), "lost", legs, NOW).back).toBe(0);
  });
  it("keeps a sane pot through a device merge and drops one below the stake", () => {
    expect(mergeMoney([e(2030, 20146.66)], [], NOW)[0].pot).toBe(20147);
    expect(mergeMoney([{ ...e(2030), pot: 100 }], [], NOW)[0].pot).toBeUndefined();
  });
});
