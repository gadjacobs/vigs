"use server";
import { currentUser, mergeCodes, updateProfile, type Prefs, type SavedCode, type SavedFilter } from "@/lib/profile";
import { storeReady } from "@/lib/store";

async function me() {
  const user = await currentUser();
  return user && storeReady() ? user : null;
}

/** Merge this device's codes with the account's and return the union. */
export async function syncCodes(local: SavedCode[]): Promise<SavedCode[] | null> {
  const user = await me();
  if (!user) return null;
  const p = await updateProfile(user, (p) => {
    const hidden = new Set(p.hidden ?? []);
    return { ...p, codes: mergeCodes(p.codes ?? [], Array.isArray(local) ? local.slice(0, 60) : []).filter((c) => !hidden.has(c.code)) };
  });
  return p.codes;
}

/** Remove a code from Codes on every device (the record keeps its result). */
export async function hideCode(code: string, undo = false) {
  const user = await me();
  if (!user || !/^[A-Z0-9]{4,12}$/.test(code)) return;
  await updateProfile(user, (p) => {
    const hidden = new Set(p.hidden ?? []);
    if (undo) hidden.delete(code);
    else hidden.add(code);
    return { ...p, hidden: [...hidden].slice(-300), codes: undo ? p.codes : (p.codes ?? []).filter((c) => c.code !== code) };
  });
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

/** Save the current Tonight filters under a name (replacing one with the same name). */
export async function saveFilter(name: string, qs: string): Promise<SavedFilter[] | null> {
  const user = await me();
  const n = name.trim().slice(0, 24);
  if (!user || !n || qs.length > 2000) return null;
  const p = await updateProfile(user, (p) => ({
    ...p, filters: [{ name: n, qs }, ...(p.filters ?? []).filter((f) => f.name.toLowerCase() !== n.toLowerCase())].slice(0, 12),
  }));
  return p.filters ?? [];
}

export async function deleteFilter(name: string): Promise<SavedFilter[] | null> {
  const user = await me();
  if (!user) return null;
  const p = await updateProfile(user, (p) => ({ ...p, filters: (p.filters ?? []).filter((f) => f.name !== name) }));
  return p.filters ?? [];
}

export async function savePrefs(prefs: Prefs) {
  const user = await me();
  if (!user) return false;
  const clean: Prefs = {
    name: typeof prefs.name === "string" ? prefs.name.trim().slice(0, 32) : undefined,
    stake: Number.isFinite(prefs.stake) ? Math.min(10_000_000, Math.max(0, Math.round(Number(prefs.stake)))) : undefined,
    home: prefs.home === "/picks" || prefs.home === "/codes" ? prefs.home : "/",
  };
  await updateProfile(user, (p) => ({ ...p, prefs: { ...p.prefs, ...clean } }));
  return true;
}
