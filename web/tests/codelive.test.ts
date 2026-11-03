import { describe, expect, it } from "vitest";
import { breakingLeg, codeIn } from "../app/code-live";
import type { Tracked } from "../lib/codes";

describe("paste to track", () => {
  it("finds a booking code in pasted text", () => {
    expect(codeIn("R1G0WC")).toBe("R1G0WC");
    expect(codeIn(" r1g0wc ")).toBe("R1G0WC");
    expect(codeIn("Play this: GGQH9D 🔥 odds 49")).toBe("GGQH9D");
    expect(codeIn("https://www.sportybet.com/ng/?shareCode=ab12cd&c=ng")).toBe("AB12CD");
    expect(codeIn("hello there")).toBeNull();
    expect(codeIn("WINNER")).toBeNull(); // a word, no digit
    expect(codeIn("12345")).toBeNull();  // a number, no letter
  });
});

describe("the leg that broke a code", () => {
  const leg = (id: string, kickoff: number, status: string) => ({ eventId: id, league: "England", home: `H${id}`, away: `A${id}`, kickoff,
    market: "O15", label: "Over 1.5", status, score: status === "lost" ? "0:1" : null, ht: null, odds: 1.3, prematch: 1.3, live: false, shareOdds: 1.3 });
  it("is the first lost leg in kick-off order", () => {
    const t = { code: "AAAA11", legs: [leg("3", 30, "lost"), leg("1", 10, "won"), leg("2", 20, "lost")] } as unknown as Tracked;
    const b = breakingLeg(t)!;
    expect([b.leg.eventId, b.at, b.of]).toEqual(["2", 2, 3]);
    expect(breakingLeg({ code: "B", legs: [leg("1", 1, "won")] } as unknown as Tracked)).toBeNull();
  });
});
