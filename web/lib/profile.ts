import { cookies } from "next/headers";
import { cache } from "react";
import { verify } from "./auth";
import { getJson, setJson, storeReady } from "./store";

// What an account shares across its devices: booked codes, last filters, view and theme.
export type SavedCode = { code: string; at: number; legs: number; odds: number; last: number };
export type Profile = {
  codes: SavedCode[];
  query?: string;
  view?: "simple" | "detailed";
  theme?: "system" | "light" | "dark";
  updated: number;
};

const KEEP_DAYS = 30;
const MAX_CODES = 60;

/** Union of two code lists by code, newest first, without stale or excess entries. */
export function mergeCodes(a: SavedCode[], b: SavedCode[], now = Date.now()): SavedCode[] {
  const by = new Map<string, SavedCode>();
  for (const c of [...a, ...b]) {
    if (!c || !/^[A-Z0-9]{4,12}$/.test(c.code) || c.last < now - KEEP_DAYS * 86_400_000) continue;
    const old = by.get(c.code);
    if (!old || c.at > old.at) by.set(c.code, { code: c.code, at: +c.at, legs: +c.legs, odds: +c.odds, last: +c.last });
  }
  return [...by.values()].sort((x, y) => y.at - x.at).slice(0, MAX_CODES);
}

export async function currentUser(): Promise<string | null> {
  return verify((await cookies()).get("vig_auth")?.value);
}

export async function loadProfile(user: string | null): Promise<Profile | null> {
  if (!user || !storeReady()) return null;
  try {
    return await getJson<Profile>(`profile:${user}`);
  } catch {
    return null;
  }
}

export async function updateProfile(user: string, change: (p: Profile) => Profile): Promise<Profile> {
  const p = (await getJson<Profile>(`profile:${user}`)) ?? { codes: [], updated: 0 };
  const next = { ...change(p), updated: Date.now() };
  await setJson(`profile:${user}`, next);
  return next;
}

/** The signed-in account's profile, or null without a store. Read once per request. */
export const myProfile = cache(async () => {
  const user = await currentUser();
  return { user, profile: await loadProfile(user) };
});
