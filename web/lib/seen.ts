import { addTo, setJson, storeReady } from "./store";

// "Last seen" per account for the admin page. Kept apart from lib/activity.ts so
// the proxy, which calls it on every signed-in request, stays small.
const EVERY = 5 * 60_000;
const lastTouch = new Map<string, number>();

/** Note that an account used the app (at most once per 5 minutes per server). */
export async function touchSeen(user: string, now = Date.now()) {
  if (!storeReady() || now - (lastTouch.get(user) ?? 0) < EVERY) return;
  lastTouch.set(user, now);
  await Promise.all([setJson(`seen:${user}`, now), addTo("users", user)]).catch(() => undefined);
}
