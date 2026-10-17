"use server";
import { currentUser, loadProfile, mergeCodes, updateProfile, type Prefs, type SavedCode, type SavedFilter } from "@/lib/profile";
import { impossible, type SlipWatch } from "@/lib/watches";
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
  if (prefs.onboarded !== undefined) clean.onboarded = Boolean(prefs.onboarded);
  await updateProfile(user, (p) => ({ ...p, prefs: { ...p.prefs, ...clean } }));
  return true;
}

/** The first-run tour is done (or skipped): keep the choices made in it. */
export async function finishOnboarding(choice: { view?: "simple" | "detailed"; stake?: number }) {
  const user = await me();
  if (!user) return false;
  const view = choice.view === "detailed" || choice.view === "simple" ? choice.view : undefined;
  const stake = Number.isFinite(choice.stake) && Number(choice.stake) > 0 ? Math.min(10_000_000, Math.round(Number(choice.stake))) : undefined;
  await updateProfile(user, (p) => ({
    ...p, ...(view ? { view } : {}),
    prefs: { ...p.prefs, onboarded: true, ...(stake ? { stake } : {}) },
  }));
  return true;
}

/** Add or replace a slip alert (up to 10 per account). */
export async function saveWatch(w: SlipWatch): Promise<SlipWatch[] | { error: string }> {
  const user = await me();
  if (!user) return { error: "Sign in to set slip alerts." };
  const p0 = await loadProfile(user);
  const source = String(w.source ?? "");
  const okSource = source === "template:top" || source === "template:trusted"
    || (source.startsWith("filter:") && (p0?.filters ?? []).some((f) => `filter:${f.name}` === source));
  if (!okSource) return { error: "Pick a saved filter or a template." };
  const minLegs = Math.min(50, Math.max(1, Math.round(Number(w.minLegs) || 1)));
  const minChance = Number(w.minChance) > 0 ? Math.min(0.99, Number(w.minChance)) : undefined;
  const minOdds = Number(w.minOdds) > 1 ? Math.min(1_000_000, Number(w.minOdds)) : undefined;
  const minLeg = Number(w.minLeg) > 0 ? Math.min(0.99, Math.max(0.05, Number(w.minLeg))) : undefined;
  const why = impossible({ minChance, minOdds });
  if (why) return { error: why };
  const clean: SlipWatch = { id: /^[a-z0-9]{6,12}$/.test(String(w.id)) ? w.id : Math.random().toString(36).slice(2, 10), source, minLegs, minChance, minLeg, minOdds };
  const p = await updateProfile(user, (p) => ({ ...p, watches: [clean, ...(p.watches ?? []).filter((x) => x.id !== clean.id)].slice(0, 10) }));
  return p.watches ?? [];
}

export async function removeWatch(id: string): Promise<SlipWatch[] | null> {
  const user = await me();
  if (!user) return null;
  const p = await updateProfile(user, (p) => ({ ...p, watches: (p.watches ?? []).filter((x) => x.id !== id) }));
  return p.watches ?? [];
}
