"use server";
import { currentUser, mergeCodes, updateProfile, type SavedCode } from "@/lib/profile";
import { storeReady } from "@/lib/store";

async function me() {
  const user = await currentUser();
  return user && storeReady() ? user : null;
}

/** Merge this device's codes with the account's and return the union. */
export async function syncCodes(local: SavedCode[]): Promise<SavedCode[] | null> {
  const user = await me();
  if (!user) return null;
  const p = await updateProfile(user, (p) => ({ ...p, codes: mergeCodes(p.codes ?? [], Array.isArray(local) ? local.slice(0, 60) : []) }));
  return p.codes;
}

export async function saveQuery(qs: string) {
  const user = await me();
  if (user && qs.length < 2000) await updateProfile(user, (p) => ({ ...p, query: qs }));
}

export async function saveView(view: "simple" | "detailed") {
  const user = await me();
  if (user && (view === "simple" || view === "detailed")) await updateProfile(user, (p) => ({ ...p, view }));
}

export async function saveTheme(theme: "system" | "light" | "dark") {
  const user = await me();
  if (user && ["system", "light", "dark"].includes(theme)) await updateProfile(user, (p) => ({ ...p, theme }));
}
