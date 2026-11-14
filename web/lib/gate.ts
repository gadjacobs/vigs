import { claim, del, getJson, members, setJson, swap } from "./store";

// Store commands cost money: Upstash counts every one (its free plan allows
// 500,000 a month), and a tick that asked the store ten things every 12 seconds,
// plus chores that rewrote the same prices every minute, used them up in eight
// days. The background tick is one long-lived process (web/tools/tick.mts sets
// TICK_PROCESS=1), so it keeps its own clocks and a copy of what it last read or
// wrote, and touches the store only when something changed. Anywhere else (a
// page, /api/push/tick) every helper here falls back to the store as before.

export const tickProcess = () => process.env.TICK_PROCESS === "1";

const clocks = new Map<string, number>();
/** True at most once per `seconds`: by this process's clock in the tick, else by a shared store claim. */
export async function gate(key: string, seconds: number, now = Date.now()): Promise<boolean> {
  if (tickProcess()) {
    if (now - (clocks.get(key) ?? -Infinity) < seconds * 1000) return false;
    clocks.set(key, now);
    return true;
  }
  return claim(key, seconds).catch(() => true);
}

// The tick's copy of store values: the latest it knows (`json`), when it last
// read the store (`read`), and what and when it last wrote (`wrote`, `wroteAt`).
type Memo = { json: string; read: number; wrote?: string; wroteAt?: number };
const memo = new Map<string, Memo>();

/** A store value, read from the store at most every `seconds` in the tick (always elsewhere). */
export async function cachedJson<T>(key: string, seconds: number): Promise<T | null> {
  const m = memo.get(key);
  if (tickProcess() && m && Date.now() - m.read < seconds * 1000) return JSON.parse(m.json) as T;
  const v = await getJson<T>(key);
  if (tickProcess()) memo.set(key, { json: JSON.stringify(v), read: Date.now() });
  return v;
}

const without = (v: unknown, ignore: string[]) =>
  ignore.length && v && typeof v === "object" ? JSON.stringify({ ...(v as object), ...Object.fromEntries(ignore.map((k) => [k, undefined])) }) : JSON.stringify(v);

/**
 * Write a value unless the tick knows the store already holds it. `ignore`: fields
 * whose change alone waits up to `every` seconds (the tick keeps the newest in its copy);
 * `every` also rewrites an unchanged value that often (for values with an expiry readers check).
 */
export async function setIfChanged(key: string, v: unknown, o: { ttl?: number; ignore?: string[]; every?: number } = {}): Promise<boolean> {
  const json = JSON.stringify(v);
  if (!tickProcess()) { await setJson(key, v, o.ttl); return true; }
  const m = memo.get(key);
  const fresh = m?.wroteAt !== undefined && (!o.every || Date.now() - m.wroteAt < o.every * 1000);
  if (m && fresh && m.wrote !== undefined && without(JSON.parse(m.wrote), o.ignore ?? []) === without(v, o.ignore ?? [])) {
    m.json = json;
    return false;
  }
  await setJson(key, v, o.ttl);
  memo.set(key, { json, read: m?.read ?? Date.now(), wrote: json, wroteAt: Date.now() });
  return true;
}

/** Drop the tick's copy of a key (deleted, or changed some other way). */
export const forget = (key: string) => { memo.delete(key); sets.delete(key); };

const sets = new Map<string, { at: number; ids: string[] }>();
/** A set's members, read at most every `seconds` in the tick. */
export async function cachedMembers(set: string, seconds: number): Promise<string[]> {
  const c = sets.get(set);
  if (tickProcess() && c && Date.now() - c.at < seconds * 1000) return [...c.ids];
  const ids = await members(set);
  if (tickProcess()) sets.set(set, { at: Date.now(), ids });
  return ids;
}
/** Tell the tick's copy of a set that this member has gone. */
export const dropMember = (set: string, id: string) => {
  const c = sets.get(set);
  if (c) c.ids = c.ids.filter((x) => x !== id);
};

// The tick's lease: one running tick process at a time (two overlap for a few
// minutes when a run hands over to its successor). Held for 3 minutes and renewed
// every 2 minutes with plain commands (Upstash bills every command a script
// runs too): a SET that returns the old holder, and a SET of `lastTick`. A run
// that finds another holder puts it back and waits.
const me = JSON.stringify(`${process.pid}-${Math.random().toString(36).slice(2, 8)}`); // JSON, so getJson reads it
let leaseAt: number | null = null;
/** True while this process holds the tick's lease (renewing it, and `lastTick`, every 2 minutes). */
export async function holdLease(now = Date.now()): Promise<boolean> {
  if (leaseAt !== null && now - leaseAt < 120_000) return true;
  const old = await swap("tick:lease", me, 180);
  if (old !== null && old !== me) {
    await swap("tick:lease", old, 180);
    leaseAt = null;
    return false;
  }
  leaseAt = now;
  await setJson("lastTick", now);
  return true;
}
/** Let the next run take over at once (the end of a run). */
export async function releaseLease() {
  if (leaseAt === null) return;
  leaseAt = null;
  await del("tick:lease").catch(() => undefined);
}

/** Test hook: forget every clock and copy. */
export function resetGate() { clocks.clear(); memo.clear(); sets.clear(); leaseAt = null; }
