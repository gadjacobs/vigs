import webpush from "web-push";
import { summary, trackWithPrematch } from "./codes";
import { addTo, del, getJson, members, removeFrom, setJson, setJsonIfAbsent, storeReady } from "./store";

// Push notifications: booked codes that win or lose, and tips at chosen times.
// The collector (GitHub Actions) calls /api/push/tick every few minutes.

export type Sub = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  results: boolean; // tell me when a watched code wins or loses
  tips: string[]; // "HH:MM" Lagos
  query: string; // Tonight filters for tips when the account has none saved
  user?: string; // account, whose latest filters the tips follow
  ours?: OursPrefs; // Our picks on a schedule
  lastOurs?: number;
  lastTip: number;
  created: number;
};
export type OursPrefs = { set: string; every: number; from: string; to: string }; // every: hours, 0 = off
export type Watch = { code: string; subs: string[]; lastKickoff: number; created: number };
export type Payload = { title: string; body: string; url: string; tag?: string };

const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:vig@example.com";
type Vapid = { publicKey: string; privateKey: string };

export const pushReady = storeReady;

/** Push signing keys: from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, else made once and kept in the store. */
export async function vapid(): Promise<Vapid> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const have = await getJson<Vapid>("vapid");
  if (have) return have;
  await setJsonIfAbsent("vapid", webpush.generateVAPIDKeys());
  return (await getJson<Vapid>("vapid"))!;
}

export const vapidPublicKey = async () => (await vapid()).publicKey;

export async function subId(endpoint: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveSub(s: Omit<Sub, "id" | "lastTip" | "created">): Promise<Sub> {
  const id = await subId(s.endpoint);
  const old = await getJson<Sub>(`sub:${id}`);
  const sub: Sub = { ...s, id, lastTip: old?.lastTip ?? 0, lastOurs: old?.lastOurs, created: old?.created ?? Date.now() };
  await setJson(`sub:${id}`, sub);
  await addTo("subs", id);
  return sub;
}

export async function dropSub(id: string) {
  await del(`sub:${id}`);
  await removeFrom("subs", id);
}

export const loadSub = (id: string) => getJson<Sub>(`sub:${id}`);

/** Send one notification; a subscription the push service says is gone is removed. */
export async function send(sub: Sub, p: Payload): Promise<boolean> {
  const v = await vapid();
  webpush.setVapidDetails(VAPID_SUBJECT, v.publicKey, v.privateKey);
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(p), { TTL: 1800, urgency: "high" });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) await dropSub(sub.id);
    return false;
  }
}

export async function watchCode(code: string, subIdValue: string, lastKickoff: number) {
  const w = (await getJson<Watch>(`watch:${code}`)) ?? { code, subs: [], lastKickoff, created: Date.now() };
  if (!w.subs.includes(subIdValue)) w.subs.push(subIdValue);
  w.lastKickoff = Math.max(w.lastKickoff, lastKickoff);
  await setJson(`watch:${code}`, w);
  await addTo("watches", code);
}

const MIN = 60_000;
const TIP_WINDOW = 40 * MIN; // a tip more than 40 minutes late is skipped

/** Today's (Lagos) time "HH:MM" as UTC ms. Lagos is UTC+1 all year. */
export function lagosAt(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  const lagos = new Date(now + 60 * MIN);
  const t = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate(), h, m) - 60 * MIN;
  return t;
}

/** The tip time due now for this subscriber, if any. */
export function dueTip(sub: Pick<Sub, "tips" | "lastTip">, now: number): number | null {
  for (const hhmm of sub.tips) {
    for (const t of [lagosAt(hhmm, now), lagosAt(hhmm, now) - 1440 * MIN]) {
      if (t <= now && now - t < TIP_WINDOW && sub.lastTip < t) return t;
    }
  }
  return null;
}

/** Minutes past midnight in Lagos. */
const lagosMinutes = (now: number) => {
  const d = new Date(now + 60 * MIN);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** True when an Our picks notification is due: inside the Lagos window and at least `every` hours since the last. */
export function dueOurs(sub: Pick<Sub, "ours" | "lastOurs">, now: number): boolean {
  const o = sub.ours;
  if (!o || !(o.every > 0)) return false;
  const t = lagosMinutes(now), a = mins(o.from), b = mins(o.to);
  const inside = a <= b ? t >= a && t <= b : t >= a || t <= b;
  return inside && now - (sub.lastOurs ?? 0) >= o.every * 60 * MIN - 5 * MIN;
}

export type TipBuilder = (query: string, now: number) => Promise<Payload>;
export type OursBuilder = (set: string, now: number) => Promise<Payload>;

/** One pass: settle watched codes, send due tips. Returns counts for the log. */
export async function tick(buildTip: TipBuilder, now = Date.now(), buildOurs?: OursBuilder) {
  const out = { watches: 0, settled: 0, tips: 0, sent: 0, errors: 0 };
  await setJson("lastTick", now);
  const subs = new Map<string, Sub>();
  for (const id of await members("subs")) {
    const s = await loadSub(id);
    if (s) subs.set(id, s);
  }
  for (const code of await members("watches")) {
    out.watches++;
    const w = await getJson<Watch>(`watch:${code}`);
    if (!w || now > w.lastKickoff + 6 * 60 * MIN) {
      await del(`watch:${code}`);
      await removeFrom("watches", code);
      continue;
    }
    try {
      const t = await trackWithPrematch(code, now);
      if (t.state === "open") continue;
      out.settled++;
      for (const id of w.subs) {
        const s = subs.get(id);
        if (s?.results && (await send(s, {
          title: t.state === "won" ? `${code} landed` : `${code} lost`,
          body: summary(t), url: "/#codes", tag: `code-${code}`,
        }))) out.sent++;
      }
      await del(`watch:${code}`);
      await removeFrom("watches", code);
    } catch {
      out.errors++;
    }
  }
  for (const s of subs.values()) {
    if (!buildOurs || !s.ours || !dueOurs(s, now)) continue;
    out.tips++;
    try {
      if (await send(s, await buildOurs(s.ours.set, now))) out.sent++;
      await setJson(`sub:${s.id}`, { ...s, lastOurs: now });
      s.lastOurs = now;
    } catch {
      out.errors++;
    }
  }
  for (const s of subs.values()) {
    const due = dueTip(s, now);
    if (due === null) continue;
    out.tips++;
    try {
      const query = (s.user && (await getJson<{ query?: string }>(`profile:${s.user}`))?.query) || s.query;
      if (await send(s, await buildTip(query, now))) out.sent++;
      await setJson(`sub:${s.id}`, { ...(await loadSub(s.id)) ?? s, lastTip: now });
    } catch {
      out.errors++;
    }
  }
  return out;
}


/** When the collector last called the tick, for the Alerts setup check. */
export const lastTick = async () => (storeReady() ? await getJson<number>("lastTick") : null);

/** When a tick last arrived with the wrong secret. */
export const lastRefusedTick = async () => (storeReady() ? await getJson<number>("tickRefused") : null);
