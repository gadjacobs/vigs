"use server";
import { cookies } from "next/headers";
import { trackCode, type Tracked } from "@/lib/codes";
import { dropSub, loadSub, pushReady, saveSub, send, subId, watchCode } from "@/lib/push";
import { buildTip } from "@/lib/tips";

export type PushPrefs = { results: boolean; tips: string[] };
type Raw = { endpoint: string; keys: { p256dh: string; auth: string } };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Save this device's subscription; tips use the device's saved Tonight filters. */
export async function subscribePush(raw: Raw, prefs: PushPrefs) {
  if (!pushReady()) return { ok: false as const, error: "Notifications are not set up on the server yet." };
  if (!raw?.endpoint?.startsWith("https://") || !raw.keys?.p256dh || !raw.keys?.auth)
    return { ok: false as const, error: "The browser returned an unusable subscription." };
  const query = decodeURIComponent((await cookies()).get("vig_q")?.value ?? "");
  const tips = [...new Set(prefs.tips.filter((t) => TIME.test(t)))].sort().slice(0, 8);
  await saveSub({ endpoint: raw.endpoint, keys: raw.keys, results: Boolean(prefs.results), tips, query });
  return { ok: true as const };
}

export async function pushPrefs(endpoint: string) {
  if (!pushReady()) return null;
  const s = await loadSub(await subId(endpoint));
  return s ? { results: s.results, tips: s.tips, query: s.query } : null;
}

export async function unsubscribePush(endpoint: string) {
  if (pushReady()) await dropSub(await subId(endpoint));
}

export async function testPush(endpoint: string, kind: "plain" | "tip") {
  if (!pushReady()) return false;
  const s = await loadSub(await subId(endpoint));
  if (!s) return false;
  return send(s, kind === "tip"
    ? await buildTip(s.query, Date.now())
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
      return await trackCode(code);
    } catch (e) {
      return { code, error: (e as Error).message };
    }
  }));
}
