import { CODELOG_KEEP } from "./codelog";
import { del, evalScript, getJson, scan, setJson, trim } from "./store";

// Keeps the store from filling up. Vig books hundreds of codes a day, and each
// left a few keys behind for good; a full store refuses writes, which stops the
// tick (and every notification) while reads still work. New keys now expire;
// this cuts the code log back every tick and, once, gives the old per-code keys
// (codeest:, codeodds:, codealert:) an expiry, a few pages per tick.

const OLD_KEYS_SECONDS = 2 * 86400;
const PAGES_PER_TICK = 8;
// Gives each key without an expiry one, in a single round trip per page.
const EXPIRE_IF_NONE = `local n = 0
for _, k in ipairs(KEYS) do
  if redis.call('TTL', k) == -1 then redis.call('EXPIRE', k, ARGV[1]); n = n + 1 end
end
return n`;

export async function tidyStore(): Promise<{ expired: number; sweep: string }> {
  await trim("codelog", CODELOG_KEEP);
  const at = await getJson<string>("tidy:cursor");
  if (at === "done") return { expired: 0, sweep: "done" };
  let cursor = at ?? "0";
  let expired = 0;
  if (cursor === "0") await del("slatecodes"); // replaced by day-long claims
  for (let i = 0; i < PAGES_PER_TICK; i++) {
    const [next, keys] = await scan("code*:*", cursor, 1000);
    if (keys.length) expired += Number(await evalScript(EXPIRE_IF_NONE, keys, [OLD_KEYS_SECONDS]));
    cursor = next;
    if (cursor === "0") break;
  }
  await setJson("tidy:cursor", cursor === "0" ? "done" : cursor);
  return { expired, sweep: cursor === "0" ? "done" : "running" };
}
