import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/gate.ts against a fake store: the background tick must answer from its own
// copy and write only what changed; anywhere else it must go to the store.
const calls: string[] = [];
const db = new Map<string, string>();
vi.mock("../lib/store", () => ({
  claim: async (k: string) => { calls.push(`claim ${k}`); return true; },
  getJson: async (k: string) => { calls.push(`get ${k}`); const v = db.get(k); return v ? JSON.parse(v) : null; },
  setJson: async (k: string, v: unknown) => { calls.push(`set ${k}`); db.set(k, JSON.stringify(v)); },
  members: async (k: string) => { calls.push(`smembers ${k}`); return ["a", "b"]; },
  swap: async (k: string, v: string) => { calls.push(`swap ${k}`); const old = db.get(k) ?? null; db.set(k, v); return old; },
  del: async (k: string) => { calls.push(`del ${k}`); db.delete(k); },
}));
const g = await import("../lib/gate");

beforeEach(() => { calls.length = 0; db.clear(); g.resetGate(); });
afterEach(() => { delete process.env.TICK_PROCESS; vi.useRealTimers(); });

describe("in the background tick", () => {
  beforeEach(() => { process.env.TICK_PROCESS = "1"; });
  it("gates by its own clock", async () => {
    expect(await g.gate("x", 60, 1_000_000)).toBe(true);
    expect(await g.gate("x", 60, 1_030_000)).toBe(false);
    expect(await g.gate("x", 60, 1_061_000)).toBe(true);
    expect(calls).toEqual([]);
  });
  it("reads once, then from its copy; writes only changes", async () => {
    db.set("k", JSON.stringify({ a: 1 }));
    expect(await g.cachedJson("k", 60)).toEqual({ a: 1 });
    expect(await g.cachedJson("k", 60)).toEqual({ a: 1 });
    expect(calls).toEqual(["get k"]);
    expect(await g.setIfChanged("k", { a: 2 })).toBe(true);
    expect(await g.setIfChanged("k", { a: 2 })).toBe(false);
    expect(await g.cachedJson("k", 60)).toEqual({ a: 2 });
    expect(calls).toEqual(["get k", "set k"]);
  });
  it("lets an ignored field wait, but keeps it in its copy", async () => {
    vi.useFakeTimers({ now: 0 });
    await g.setIfChanged("w", { s: 1, chance: 0.5 }, { ignore: ["chance"], every: 60 });
    expect(await g.setIfChanged("w", { s: 1, chance: 0.6 }, { ignore: ["chance"], every: 60 })).toBe(false);
    expect(await g.cachedJson("w", 600)).toEqual({ s: 1, chance: 0.6 });
    expect(await g.setIfChanged("w", { s: 2, chance: 0.6 }, { ignore: ["chance"], every: 60 })).toBe(true);
    vi.setSystemTime(61_000);
    expect(await g.setIfChanged("w", { s: 2, chance: 0.7 }, { ignore: ["chance"], every: 60 })).toBe(true);
  });
  it("caches sets and drops members", async () => {
    expect(await g.cachedMembers("s", 60)).toEqual(["a", "b"]);
    g.dropMember("s", "a");
    expect(await g.cachedMembers("s", 60)).toEqual(["b"]);
    expect(calls).toEqual(["smembers s"]);
  });
  it("renews the lease every 2 minutes", async () => {
    expect(await g.holdLease(0)).toBe(true);
    expect(await g.holdLease(90_000)).toBe(true);
    expect(await g.holdLease(121_000)).toBe(true);
    expect(calls).toEqual(["swap tick:lease", "set lastTick", "swap tick:lease", "set lastTick"]);
  });
  it("gives the lease back to another holder", async () => {
    db.set("tick:lease", JSON.stringify("other"));
    expect(await g.holdLease(0)).toBe(false);
    expect(db.get("tick:lease")).toBe(JSON.stringify("other"));
    await g.releaseLease();
    expect(db.get("tick:lease")).toBe(JSON.stringify("other"));
  });
});

describe("anywhere else", () => {
  it("goes to the store every time", async () => {
    await g.gate("x", 60);
    await g.cachedJson("k", 60);
    await g.cachedJson("k", 60);
    await g.setIfChanged("k", 1);
    await g.setIfChanged("k", 1);
    expect(calls).toEqual(["claim x", "get k", "get k", "set k", "set k"]);
  });
});
