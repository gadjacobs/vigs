// Small key-value store for accounts, push subscriptions and watched codes:
// Upstash Redis over its REST API. Vercel's Upstash integration names the
// variables KV_REST_API_URL / KV_REST_API_TOKEN, optionally with a custom
// prefix (e.g. STORAGE_KV_REST_API_URL); Upstash's own are UPSTASH_REDIS_REST_*.
// A rediss:// URL from Upstash (REDIS_URL, KV_URL) also works: its password is
// the REST token.

type Found = { url: string; token: string; from: string };

export function findStore(env: Record<string, string | undefined> = process.env): Found | null {
  for (const [k, url] of Object.entries(env)) {
    const m = /^(.*?)(KV_REST_API_URL|REDIS_REST_URL|REST_API_URL)$/.exec(k);
    if (!m || !url || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(url)) continue;
    const token = env[`${m[1]}${m[2].replace("URL", "TOKEN")}`];
    if (token) return { url, token, from: k };
  }
  for (const [k, v] of Object.entries(env)) {
    if (!/(^|_)(REDIS_URL|KV_URL)$/.test(k) || !v) continue;
    try {
      const u = new URL(v);
      if (u.hostname.endsWith(".upstash.io") && u.password)
        return { url: `https://${u.hostname}`, token: decodeURIComponent(u.password), from: k };
    } catch { /* not a URL */ }
  }
  return null;
}

const FOUND = findStore();
const URL_ = FOUND?.url;
const TOKEN = FOUND?.token;

export const storeReady = () => Boolean(FOUND);
/** Names (never values) of what the server can see, for the setup check. */
export const storeSource = () => FOUND?.from ?? null;

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
