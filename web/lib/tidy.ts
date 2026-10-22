import { CODELOG_KEEP } from "./codelog";
import { CODE_KEEP_SECONDS, SLATE_CODE_SECONDS } from "./codes";
import { cmdRaw, del, evalScript, getJson, scan, setJson, trim } from "./store";

// Keeps the store from filling up. The store (Vercel's Redis, 30 MB on its free
// plan) refuses every write once full, which stops the tick and every
// notification while reads still work.
//
// The big user was Vig's own cooked slips: about 2,200 codes a day, each with its
// prematch prices (codeodds:) and estimates (codeest:) kept 14 days, some 60,000
// keys. Those now keep 36 hours (the record has them in the code log). Each tick
// this sweeps those keys a few pages at a time: keys older than 36 hours go,
// cooked-slip keys get the 36-hour expiry, and keys with no expiry get one.

const PAGES_PER_TICK = 25;
// KEYS: n code keys, then the matching n slatecode: keys. ARGV: keep, short.
const SWEEP = `local n = #KEYS / 2
local keep, short, gone, cut = tonumber(ARGV[1]), tonumber(ARGV[2]), 0, 0
for i = 1, n do
  local k = KEYS[i]
  local ttl = redis.call('TTL', k)
  if ttl == -1 then redis.call('EXPIRE', k, short); cut = cut + 1
  elseif ttl > 0 and keep - ttl > short then redis.call('DEL', k); gone = gone + 1
  elseif ttl > short and redis.call('EXISTS', KEYS[n + i]) == 1 then redis.call('EXPIRE', k, short); cut = cut + 1 end
end
return {gone, cut}`;

export type Tidy = { gone: number; cut: number; sweep: string; memory?: Memory | null };

export async function tidyStore(): Promise<Tidy> {
  await trim("codelog", CODELOG_KEEP).catch(() => undefined);
  // The cursor lives in the store; when the store is full it can't be saved, so
  // the sweep starts over next tick (deleting first, it frees room as it goes).
  let cursor = (await getJson<string>("tidy:v2").catch(() => null)) ?? "0";
  if (cursor === "done") return { gone: 0, cut: 0, sweep: "done", memory: await memory() };
  if (cursor === "0") await del("slatecodes").catch(() => undefined);
  let gone = 0, cut = 0;
  for (let i = 0; i < PAGES_PER_TICK; i++) {
    const [next, keys] = await scan("code[eo][sd]*:*", cursor, 1000);
    if (keys.length) {
      const codes = keys.map((k) => k.slice(k.indexOf(":") + 1));
      const [g, c] = (await evalScript(SWEEP, [...keys, ...codes.map((c) => `slatecode:${c}`)], [CODE_KEEP_SECONDS, SLATE_CODE_SECONDS])) as number[];
      gone += Number(g);
      cut += Number(c);
    }
    cursor = next;
    if (cursor === "0") break;
  }
  await setJson("tidy:v2", cursor === "0" ? "done" : cursor).catch(() => undefined);
  return { gone, cut, sweep: cursor === "0" ? "done" : "running", memory: await memory() };
}

export type Memory = { used: number; max: number };
/** The store's memory use and limit in bytes (Redis INFO; null where it isn't offered). */
export async function memory(): Promise<Memory | null> {
  try {
    const info = String(await cmdRaw("INFO", "memory"));
    const num = (k: string) => Number(info.match(new RegExp(`^${k}:(\\d+)`, "m"))?.[1] ?? NaN);
    const used = num("used_memory"), max = num("maxmemory");
    return Number.isFinite(used) ? { used, max: Number.isFinite(max) ? max : 0 } : null;
  } catch {
    return null;
  }
}
