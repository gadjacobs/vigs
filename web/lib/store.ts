import { createClient } from "redis";

// Small key-value store for accounts, push subscriptions and watched codes.
// Either Upstash over its REST API (KV_REST_API_URL / KV_REST_API_TOKEN, with
// or without a custom prefix, or UPSTASH_REDIS_REST_*), or any Redis reached by
// a redis:// or rediss:// URL (REDIS_URL, KV_URL), such as Vercel's Redis
// integration. An Upstash redis URL is turned into REST, since its password is
// the REST token.

type Found = { url: string; token: string; from: string; tcp?: boolean };

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
      if (u.protocol !== "redis:" && u.protocol !== "rediss:") continue;
      if (u.hostname.endsWith(".upstash.io") && u.password)
        return { url: `https://${u.hostname}`, token: decodeURIComponent(u.password), from: k };
      return { url: v, token: "", from: k, tcp: true };
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

type Tcp = ReturnType<typeof createClient>;
let tcp: Promise<Tcp> | null = null;

/** One connection per server instance, reopened if it drops. A serverless
 * instance can be frozen between requests, leaving a socket that looks open but
 * never answers, so every command has a deadline and a miss drops the socket. */
function tcpClient(): Promise<Tcp> {
  if (!tcp) {
    const c = createClient({
      url: FOUND!.url, disableOfflineQueue: true,
      socket: { connectTimeout: 3000, keepAlive: 5000, reconnectStrategy: false },
    });
    c.on("error", () => { tcp = null; });
    c.on("end", () => { tcp = null; });
    tcp = c.connect().then(() => c).catch((e) => { tcp = null; throw e; });
  }
  return tcp;
}

const DEADLINE = 2500;

function within<T>(p: Promise<T>, ms: number, onMiss: () => void): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, reject) => { t = setTimeout(() => { onMiss(); reject(new Error("Storage timed out")); }, ms); }),
  ]);
}

async function cmd<T>(...args: (string | number)[]): Promise<T> {
  if (FOUND?.tcp) {
    const run = async () => (await (await tcpClient()).sendCommand(args.map(String))) as T;
    const drop = () => {
      const old = tcp;
      tcp = null;
      old?.then((c) => c.disconnect()).catch(() => undefined);
    };
    try {
      return await within(run(), DEADLINE, drop);
    } catch {
      return await within(run(), DEADLINE, drop); // once more on a fresh connection
    }
  }
  if (!URL_ || !TOKEN) throw new Error("Storage is not set up");
  const res = await fetch(URL_, {
    method: "POST", signal: AbortSignal.timeout(DEADLINE * 2),
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
/** A short-lived claim: true if this caller got it. */
export const claim = async (key: string, seconds: number) => (await cmd<string | null>("SET", P + key, "1", "NX", "EX", seconds)) === "OK";
export const del = (key: string) => cmd("DEL", P + key);
export const push = (list: string, v: unknown) => cmd<number>("RPUSH", P + list, JSON.stringify(v));
export async function range<T>(list: string, start: number, stop: number): Promise<T[]> {
  return (await cmd<string[]>("LRANGE", P + list, start, stop)).map((s) => JSON.parse(s) as T);
}
export const members = (set: string) => cmd<string[]>("SMEMBERS", P + set);
export const addTo = (set: string, id: string) => cmd("SADD", P + set, id);
export const removeFrom = (set: string, id: string) => cmd("SREM", P + set, id);
