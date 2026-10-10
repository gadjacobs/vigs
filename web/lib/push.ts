import webpush from "web-push";
import { summary, trackWithPrematch, type Tracked } from "./codes";
import { liveLegs, slipChance, type LiveLeg } from "./live";
import type { Profile } from "./profile";
import { addTo, claim, del, getJson, members, removeFrom, setJson, setJsonIfAbsent, storeReady } from "./store";

// Push notifications: booked codes that win or lose, and tips at chosen times.
// The collector (GitHub Actions) calls /api/push/tick every few minutes.

export type Sub = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  results: boolean; // tell me when a watched code wins or loses
  swings?: boolean; // goals that move a watched code's chance, and its last leg (default on)
  tips: string[]; // "HH:MM" Lagos
  query: string; // Tonight filters for tips when the account has none saved
  user?: string; // account, whose latest filters the tips follow
  ours?: OursPrefs; // Our picks on a schedule
  lastOurs?: number;
  lastTip: number;
  created: number;
};
export type OursPrefs = { set: string; every: number; from: string; to: string }; // every: hours, 0 = off
export type WatchLeg = { eventId: string; market: string; kickoff: number; home: string; away: string; label: string };
export type Watch = {
  code: string; subs: string[]; lastKickoff: number; created: number;
  legs?: WatchLeg[]; // read once from SportyBet
  settled?: Record<string, boolean>; // "eventId|market" → landed, from SportyBet's results
  scores?: Record<string, string>; // last live score per match
  chance?: number; // last chance the code lands
  told?: string[]; // one-off notifications already sent ("last")
};
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

// A code whose result has been sent is marked done for a few days, so it is
// never watched (or announced) again while it is still on the account.
const DONE_SECONDS = 3 * 86_400;
const isDone = async (code: string) => (await getJson<number>(`done:${code}`)) !== null;

export async function watchCode(code: string, subIdValue: string, lastKickoff: number) {
  if (await isDone(code)) return;
  const old = await getJson<Watch>(`watch:${code}`);
  if (old && old.subs.includes(subIdValue) && old.lastKickoff >= lastKickoff) return;
  const w = old ?? { code, subs: [], lastKickoff, created: Date.now() };
  if (!w.subs.includes(subIdValue)) w.subs.push(subIdValue);
  w.lastKickoff = Math.max(w.lastKickoff, lastKickoff);
  await setJson(`watch:${code}`, w);
  await addTo("watches", code);
}

const legKey = (l: { eventId: string; market: string }) => `${l.eventId}|${l.market}`;
const pct = (p: number) => `${p >= 0.995 && p < 1 ? ">99" : Math.round(p * 100)}%`;
const SWING = 0.15; // a goal that moves a code's chance by 15 points or more is worth a notification

/** What a watched code's live state says to tell its subscribers, if anything. */
export function liveNews(w: Watch, live: Record<string, LiveLeg>): { payload: Payload | null; chance: number | null; scores: Record<string, string>; last: boolean } {
  const legs = w.legs ?? [];
  const settled = w.settled ?? {};
  const scores: Record<string, string> = { ...w.scores };
  const goals: { leg: WatchLeg; x: LiveLeg }[] = [];
  const chances = legs.map((l) => {
    if (legKey(l) in settled) return settled[legKey(l)] ? 1 : 0;
    const x = live[legKey(l)];
    if (x?.state === "playing" && x.score) {
      if (w.scores?.[l.eventId] !== undefined && w.scores[l.eventId] !== x.score) goals.push({ leg: l, x });
      scores[l.eventId] = x.score;
    }
    return x?.chance ?? null;
  });
  const chance = slipChance(chances);
  const openLegs = legs.filter((l, i) => chances[i] !== 1);
  const last = openLegs.length === 1 && chances.every((c) => c !== 0) && !(w.told ?? []).includes("last");
  if (goals.length && chance !== null && w.chance !== undefined && Math.abs(chance - w.chance) >= SWING) {
    const g = goals[0];
    const [h, a] = g.x.score!.split(":");
    return {
      chance, scores, last,
      payload: {
        title: `${chance > w.chance ? "▲" : "▼"} ${g.leg.home} ${h}–${a} ${g.leg.away}${g.x.minute !== null ? ` (${g.x.minute}')` : ""}`,
        body: chance === 0 ? `${w.code} is beaten: ${g.leg.label.toLowerCase()} can't land now.`
          : `${w.code} now ${pct(chance)} to land (was ${pct(w.chance)}).${last ? " One leg left." : ""}`,
        url: "/codes", tag: `code-${w.code}`,
      },
    };
  }
  if (last && chance !== null && chance > 0) {
    const l = openLegs[0];
    return {
      chance, scores, last: true,
      payload: {
        title: `${w.code}: one leg left`,
        body: `${legs.length - 1} of ${legs.length} landed. Last: ${l.home} v ${l.away}, ${l.label.toLowerCase()}, ${pct(chance)} to land. Open Codes to ride it or hedge.`,
        url: "/codes", tag: `code-${w.code}`,
      },
    };
  }
  return { payload: null, chance, scores, last: false };
}

/** Codes on the accounts behind these subscriptions that are still to play or in play. */
async function accountCodes(subs: Sub[], now: number): Promise<{ sub: Sub; code: string; last: number }[]> {
  const out: { sub: Sub; code: string; last: number }[] = [];
  const profiles = new Map<string, Profile | null>();
  for (const s of subs) {
    if (!s.user || (!s.results && s.swings === false)) continue;
    if (!profiles.has(s.user)) profiles.set(s.user, await getJson<Profile>(`profile:${s.user}`).catch(() => null));
    const p = profiles.get(s.user);
    const hidden = new Set(p?.hidden ?? []);
    for (const c of p?.codes ?? [])
      if (!hidden.has(c.code) && c.last + 90 * MIN > now && c.at > now - 2 * 1440 * MIN) out.push({ sub: s, code: c.code, last: c.last });
  }
  return out;
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

/** One pass: follow watched codes live, settle them, send due tips. Returns
 * counts for the log, and `next`: seconds until the collector should call again
 * (short while a watched leg is in play). */
export async function tick(buildTip: TipBuilder, now = Date.now(), buildOurs?: OursBuilder) {
  const out = { watches: 0, live: 0, settled: 0, swings: 0, tips: 0, sent: 0, errors: 0, next: 120 };
  await setJson("lastTick", now);
  const subs = new Map<string, Sub>();
  for (const id of await members("subs")) {
    const s = await loadSub(id);
    if (s) subs.set(id, s);
  }
  // Every open code on a subscribed account is watched, however it was booked.
  for (const { sub, code, last } of await accountCodes([...subs.values()], now).catch(() => []))
    await watchCode(code, sub.id, last).catch(() => undefined);

  const tell = async (w: Watch, p: Payload, kind: "results" | "swings") => {
    for (const id of w.subs) {
      const s = subs.get(id);
      if (s && (kind === "results" ? s.results : s.swings !== false) && (await send(s, p))) out.sent++;
    }
  };
  const drop = async (code: string) => {
    await del(`watch:${code}`);
    await removeFrom("watches", code);
  };
  // The result goes out once: claiming done:{code} fails if it was already sent.
  const settle = async (w: Watch, p: Payload) => {
    out.settled++;
    if (await claim(`done:${w.code}`, DONE_SECONDS)) await tell(w, p, "results");
    await drop(w.code);
  };
  const final = (w: Watch, t: Tracked) =>
    settle(w, { title: t.state === "won" ? `✓ ${w.code} landed` : `✗ ${w.code} lost`, body: summary(t), url: "/codes", tag: `code-${w.code}` });

  for (const code of await members("watches")) {
    out.watches++;
    const w = await getJson<Watch>(`watch:${code}`);
    if (!w || now > w.lastKickoff + 6 * 60 * MIN) {
      await drop(code);
      continue;
    }
    try {
      if (!w.legs) {
        const t = await trackWithPrematch(code, now);
        if (t.state !== "open") { await final(w, t); continue; }
        w.legs = t.legs.map((l) => ({ eventId: l.eventId, market: l.market, kickoff: l.kickoff, home: l.home, away: l.away, label: l.label }));
        w.settled = Object.fromEntries(t.legs.filter((l) => l.status === "won" || l.status === "lost").map((l) => [legKey(l), l.status === "won"]));
        w.lastKickoff = t.lastKickoff;
      }
      const open = w.legs.filter((l) => !(legKey(l) in (w.settled ?? {})));
      if (!open.some((l) => l.kickoff <= now + MIN)) { await setJson(`watch:${code}`, w); continue; }
      out.live++;
      out.next = 20;
      const live = await liveLegs(open, now);
      // A leg that has ended, or that the score has already beaten, is read
      // again from SportyBet so the result goes out at once.
      const beaten = open.some((l) => live[legKey(l)]?.state === "playing" && live[legKey(l)]?.chance === 0);
      if (beaten || open.some((l) => live[legKey(l)]?.state === "ended")) {
        const t = await trackWithPrematch(code, now);
        if (t.state !== "open") { await final(w, t); continue; }
        w.settled = { ...w.settled, ...Object.fromEntries(t.legs.filter((l) => l.status === "won" || l.status === "lost").map((l) => [legKey(l), l.status === "won"])) };
      }
      const news = liveNews(w, live);
      if (beaten && news.chance === 0) {
        const l = open.find((x) => live[legKey(x)]?.chance === 0)!;
        const x = live[legKey(l)];
        await settle(w, { title: `✗ ${code} lost`, body: `${l.home} v ${l.away}: ${l.label.toLowerCase()} is beaten at ${x.score}${x.minute !== null ? ` (${x.minute}')` : ""}.`, url: "/codes", tag: `code-${code}` });
        continue;
      }
      if (news.payload) {
        out.swings++;
        await tell(w, news.payload, "swings");
      }
      await setJson(`watch:${code}`, {
        ...w, scores: news.scores, chance: news.chance ?? w.chance,
        told: news.last ? [...(w.told ?? []), "last"] : w.told,
      });
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
