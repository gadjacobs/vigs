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
