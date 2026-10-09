// Small key-value store for push subscriptions and watched codes: Upstash Redis
// over its REST API (Vercel → Storage → Upstash for Redis sets these variables).
const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeReady = () => Boolean(URL_ && TOKEN);

async function cmd<T>(...args: (string | number)[]): Promise<T> {
  if (!URL_ || !TOKEN) throw new Error("Storage is not set up");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args.map(String)),
    cache: "no-store",
  });
  const body = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || body.error) throw new Error(`Storage: ${body.error ?? res.status}`);
  return body.result as T;
}

const P = "vig:";

export async function getJson<T>(key: string): Promise<T | null> {
  const s = await cmd<string | null>("GET", P + key);
  return s ? (JSON.parse(s) as T) : null;
}
export const setJson = (key: string, v: unknown) => cmd("SET", P + key, JSON.stringify(v));
export const setJsonIfAbsent = (key: string, v: unknown) => cmd("SET", P + key, JSON.stringify(v), "NX");
export const del = (key: string) => cmd("DEL", P + key);
export const members = (set: string) => cmd<string[]>("SMEMBERS", P + set);
export const addTo = (set: string, id: string) => cmd("SADD", P + set, id);
export const removeFrom = (set: string, id: string) => cmd("SREM", P + set, id);
