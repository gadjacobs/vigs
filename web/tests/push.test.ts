import { describe, expect, it } from "vitest";
import { dueTip, lagosAt } from "../lib/push";

describe("tip schedule", () => {
  const now = Date.UTC(2026, 9, 9, 20, 10); // 21:10 Lagos
  it("reads times as Lagos", () => {
    expect(lagosAt("21:00", now)).toBe(Date.UTC(2026, 9, 9, 20, 0));
    expect(lagosAt("00:30", Date.UTC(2026, 9, 9, 23, 40))).toBe(Date.UTC(2026, 9, 9, 23, 30)); // 00:40 Lagos next day
  });
  it("fires once, within 40 minutes", () => {
    expect(dueTip({ tips: ["21:00"], lastTip: 0 }, now)).toBe(Date.UTC(2026, 9, 9, 20, 0));
    expect(dueTip({ tips: ["21:00"], lastTip: now - 60_000 }, now)).toBeNull();
    expect(dueTip({ tips: ["20:00"], lastTip: 0 }, now)).toBeNull(); // 70 minutes late
    expect(dueTip({ tips: ["21:30"], lastTip: 0 }, now)).toBeNull(); // not yet
    expect(dueTip({ tips: ["23:50"], lastTip: 0 }, Date.UTC(2026, 9, 9, 23, 5))).toBe(Date.UTC(2026, 9, 9, 22, 50)); // 00:05 Lagos
  });
});

import { findStore } from "../lib/store";

describe("store variables", () => {
  it("finds Vercel, prefixed, Upstash and redis-URL forms", () => {
    expect(findStore({ KV_REST_API_URL: "https://a.upstash.io", KV_REST_API_TOKEN: "t" })?.from).toBe("KV_REST_API_URL");
    expect(findStore({ STORAGE_KV_REST_API_URL: "https://a.upstash.io", STORAGE_KV_REST_API_TOKEN: "t" })?.token).toBe("t");
    expect(findStore({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })?.url).toBe("https://a.upstash.io");
    expect(findStore({ REDIS_URL: "rediss://default:s3cr%3Dt@b.upstash.io:6379" })).toEqual({ url: "https://b.upstash.io", token: "s3cr=t", from: "REDIS_URL" });
    expect(findStore({ KV_REST_API_URL: "https://a.upstash.io" })).toBeNull();
    expect(findStore({ REDIS_URL: "redis://default:x@redis-123.cloud.redislabs.com:12345" })).toEqual(
      { url: "redis://default:x@redis-123.cloud.redislabs.com:12345", token: "", from: "REDIS_URL", tcp: true });
    expect(findStore({ REDIS_URL: "postgres://x@y/z" })).toBeNull();
  });
});

import { accountFor, accounts, sessionValue, verify } from "../lib/auth";
import { mergeCodes } from "../lib/profile";

describe("accounts", () => {
  it("parses ACCOUNTS, falls back to APP_PASSWORD, verifies cookies", async () => {
    const env = { ACCOUNTS: "Gad:one, ada:two" };
    expect(accounts(env).map((a) => a.name)).toEqual(["gad", "ada"]);
    expect(accountFor("two", env)?.name).toBe("ada");
    const cookie = await sessionValue(accounts(env)[0]);
    expect(await verify(cookie, env)).toBe("gad");
    expect(await verify(cookie.replace("gad.", "ada."), env)).toBeNull();
    expect(await verify(undefined, {})).toBe("me"); // open app
    expect(accounts({ APP_PASSWORD: "x" })).toEqual([{ name: "me", password: "x" }]);
  });
  it("merges codes from two devices", () => {
    const now = 1_800_000_000_000;
    const c = (code: string, at: number) => ({ code, at, legs: 3, odds: 5, last: now });
    const m = mergeCodes([c("AAAA11", 1), c("BBBB22", 5)], [c("AAAA11", 9), c("CCCC33", 3), { ...c("OLDOLD", 1), last: 0 }], now);
    expect(m.map((x) => x.code)).toEqual(["AAAA11", "BBBB22", "CCCC33"]);
    expect(m[0].at).toBe(9);
  });
});

import { dueOurs } from "../lib/push";

describe("our picks schedule", () => {
  const at = (h: number, m = 0) => Date.UTC(2026, 9, 10, h - 1, m); // Lagos h:m
  const ours = { set: "safe", every: 2, from: "09:00", to: "23:00" };
  it("sends inside the window, every N hours", () => {
    expect(dueOurs({ ours, lastOurs: 0 }, at(10))).toBe(true);
    expect(dueOurs({ ours, lastOurs: at(9) }, at(10))).toBe(false);
    expect(dueOurs({ ours, lastOurs: at(8) }, at(10))).toBe(true);
    expect(dueOurs({ ours, lastOurs: 0 }, at(8))).toBe(false); // before 09:00
    expect(dueOurs({ ours: { ...ours, every: 0 }, lastOurs: 0 }, at(10))).toBe(false);
    expect(dueOurs({ ours: { ...ours, from: "22:00", to: "02:00" }, lastOurs: 0 }, at(1))).toBe(true); // overnight
  });
});

import { googleAccountFor, googleSession, verifyGoogle } from "../lib/auth";

describe("google sign-in", () => {
  const env = { AUTH_SECRET: "s", GOOGLE_ACCOUNTS: "You@Gmail.com=me, friend@x.com" };
  it("maps listed emails to accounts and signs sessions", async () => {
    expect(googleAccountFor("you@gmail.com", env)).toBe("me");
    expect(googleAccountFor("friend@x.com", env)).toBe("friend_x_com");
    expect(googleAccountFor("other@x.com", env)).toBeNull();
    expect(googleAccountFor("other@x.com", { ...env, GOOGLE_ALLOW_ANY: "1" })).toBe("other_x_com");
    const c = await googleSession("me", env);
    expect(await verifyGoogle(c, env)).toBe("me");
    expect(await verifyGoogle(c, { ...env, AUTH_SECRET: "t" })).toBeNull();
    expect(await verifyGoogle(c, { AUTH_SECRET: "s", GOOGLE_ACCOUNTS: "friend@x.com" })).toBeNull(); // removed from the list
  });
});

import { liveNews, type Watch } from "../lib/push";
import type { LiveLeg } from "../lib/live";

describe("live notifications", () => {
  const legs = [
    { eventId: "a", market: "O15", kickoff: 0, home: "ARS", away: "EVE", label: "Over 1.5 goals" },
    { eventId: "b", market: "1", kickoff: 0, home: "LIV", away: "BHA", label: "Home win" },
  ];
  const lv = (score: string, chance: number | null, minute = 30): LiveLeg =>
    ({ state: "playing", phase: "H1", minute, score, fh: score, chance, odds: null });
  const w: Watch = { code: "ABC123", subs: [], lastKickoff: 0, created: 0, legs, scores: { a: "0:0", b: "0:0" }, chance: 0.3 };

  it("tells about a goal that swings the code by 15 points or more", () => {
    const n = liveNews(w, { "a|O15": lv("1:0", 0.8), "b|1": lv("0:0", 0.6) });
    expect(n.chance).toBeCloseTo(0.48, 12);
    expect(n.payload?.title).toBe("▲ ARS 1–0 EVE (30')");
    expect(n.payload?.body).toBe("ABC123 now 48% to land (was 30%).");
    expect(n.scores).toEqual({ a: "1:0", b: "0:0" });
  });

  it("stays quiet for small moves and without a goal", () => {
    expect(liveNews(w, { "a|O15": lv("1:0", 0.55), "b|1": lv("0:0", 0.6) }).payload).toBeNull();
    expect(liveNews(w, { "a|O15": lv("0:0", 0.9), "b|1": lv("0:0", 0.6) }).payload).toBeNull();
  });

  it("says once when one leg is left", () => {
    const n = liveNews({ ...w, settled: { "a|O15": true } }, { "b|1": lv("0:0", 0.4) });
    expect(n.last).toBe(true);
    expect(n.payload?.title).toBe("ABC123: one leg left");
    const g = liveNews({ ...w, settled: { "a|O15": true } }, { "b|1": lv("1:0", 0.7) });
    expect([g.last, g.payload?.body]).toEqual([true, "ABC123 now 70% to land (was 30%). One leg left."]);
    expect(liveNews({ ...w, settled: { "a|O15": true }, told: ["last"] }, { "b|1": lv("0:0", 0.7) }).payload).toBeNull();
  });
});
