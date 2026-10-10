"use server";
import { cookies } from "next/headers";
import { trackWithPrematch, type Tracked } from "@/lib/codes";
import { dropSub, loadSub, pushReady, saveSub, send, subId, watchCode, type OursPrefs } from "@/lib/push";
import { SETS } from "@/lib/ourpicks";
import { myProfile } from "@/lib/profile";
import { buildOurs, buildTip } from "@/lib/tips";

export type PushPrefs = { results: boolean; tips: string[]; ours?: OursPrefs };
type Raw = { endpoint: string; keys: { p256dh: string; auth: string } };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Save this device's subscription; tips use the device's saved Tonight filters. */
export async function subscribePush(raw: Raw, prefs: PushPrefs) {
  if (!pushReady()) return { ok: false as const, error: "Notifications are not set up on the server yet." };
  if (!raw?.endpoint?.startsWith("https://") || !raw.keys?.p256dh || !raw.keys?.auth)
    return { ok: false as const, error: "The browser returned an unusable subscription." };
  const { user, profile } = await myProfile();
  const query = profile?.query ?? decodeURIComponent((await cookies()).get("vig_q")?.value ?? "");
  const tips = [...new Set(prefs.tips.filter((t) => TIME.test(t)))].sort().slice(0, 8);
  const o = prefs.ours;
  const ours = o && (o.set === "cooked" || SETS.some((x) => x.id === o.set)) && TIME.test(o.from) && TIME.test(o.to)
    ? { set: o.set, every: Math.min(24, Math.max(0, Math.round(Number(o.every) || 0))), from: o.from, to: o.to } : undefined;
  await saveSub({ endpoint: raw.endpoint, keys: raw.keys, results: Boolean(prefs.results), tips, query, user: user ?? undefined, ours });
  return { ok: true as const };
}

export async function pushPrefs(endpoint: string) {
  if (!pushReady()) return null;
  const s = await loadSub(await subId(endpoint));
  return s ? { results: s.results, tips: s.tips, query: s.query, ours: s.ours } : null;
}

export async function unsubscribePush(endpoint: string) {
  if (pushReady()) await dropSub(await subId(endpoint));
}

export async function testPush(endpoint: string, kind: "plain" | "tip" | "ours") {
  if (!pushReady()) return false;
  const s = await loadSub(await subId(endpoint));
  if (!s) return false;
  const { profile } = await myProfile();
  if (kind === "ours") return send(s, await buildOurs(s.ours?.set ?? "cooked", Date.now()));
  return send(s, kind === "tip"
    ? await buildTip(profile?.query ?? s.query, Date.now())
    : { title: "Vig notifications are on", body: "You will hear here when a watched code settles, and at your tip times.", url: "/alerts" });
}

/** Tell this device when the code wins or loses. */
export async function watchBooking(code: string, endpoint: string, lastKickoff: number) {
  if (!pushReady() || !/^[A-Z0-9]{4,12}$/.test(code)) return false;
  const s = await loadSub(await subId(endpoint));
  if (!s?.results) return false;
  await watchCode(code, s.id, lastKickoff);
  return true;
}

/** Live status of recent codes (one SportyBet read each). */
export async function trackCodes(codes: string[]): Promise<(Tracked | { code: string; error: string })[]> {
  return Promise.all(codes.slice(0, 10).map(async (code) => {
    try {
      return await trackWithPrematch(code);
    } catch (e) {
      return { code, error: (e as Error).message };
    }
  }));
}

/** A cooked slip the user opened or copied: log it once as theirs, so Codes and Record show it. */
export async function adoptCode(code: string, style: string) {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return false;
  const { user } = await myProfile();
  if (!user) return false;
  const { currentSlates } = await import("@/lib/kitchen");
  const { logBooking } = await import("@/lib/codelog");
  const { addTo, storeReady } = await import("@/lib/store");
  if (!storeReady()) return false;
  const slate = (await currentSlates().catch(() => null))?.slates.find((s) => s.code === code);
  if (!slate) return false;
  if (Number(await addTo(`adopted:${user}`, code)) !== 1) return true;   // already logged
  await logBooking(code, slate.legs, `cooked:${style}`, user);
  return true;
}
