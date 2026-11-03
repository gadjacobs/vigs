// A code's state with live scores applied, shared by Codes and the live strip.
import type { Tracked } from "@/lib/codes";
import type { LiveLeg } from "@/lib/live";

export const legKey = (l: { eventId: string; market: string }) => `${l.eventId}|${l.market}`;

/** A leg's status with live scores applied: an over that has gone over has landed. */
export function effective(l: Tracked["legs"][number], live: Record<string, LiveLeg>): Tracked["legs"][number]["status"] {
  const x = live[legKey(l)];
  if (l.status === "won" || l.status === "lost" || !x) return l.status;
  if (x.chance === 1 && x.state === "playing") return "won";
  if (x.chance === 0 && x.state === "playing") return "lost";
  return x.state === "playing" ? "playing" : l.status;
}

/** Chance the whole code lands now; null until every open leg has one. */
export function codeChance(t: Tracked, live: Record<string, LiveLeg>): number | null {
  let p = 1;
  for (const l of t.legs) {
    const st = effective(l, live);
    if (st === "won") continue;
    if (st === "lost") return 0;
    const c = live[legKey(l)]?.chance;
    if (c === undefined || c === null) return null;
    p *= c;
  }
  return p;
}


/** A booking code in pasted text: SportyBet's share link (`shareCode=`), else a 5-10 character
 * capitalised token with a letter and a digit (so ordinary words are skipped). */
export function codeIn(text: string): string | null {
  const link = /shareCode=([A-Za-z0-9]{4,12})/.exec(text);
  if (link) return link[1].toUpperCase();
  const t = text.trim();
  if (/^[A-Za-z0-9]{5,10}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t)) return t.toUpperCase();
  for (const m of text.matchAll(/\b[A-Z0-9]{5,10}\b/g)) if (/\d/.test(m[0]) && /[A-Z]/.test(m[0])) return m[0];
  return null;
}


/** The leg that sank a lost code: the first lost one in kick-off order, and its place. */
export function breakingLeg(t: Tracked, live: Record<string, LiveLeg> = {}): { leg: Tracked["legs"][number]; at: number; of: number } | null {
  const legs = [...t.legs].sort((a, b) => a.kickoff - b.kickoff || a.home.localeCompare(b.home));
  const i = legs.findIndex((l) => effective(l, live) === "lost");
  return i < 0 ? null : { leg: legs[i], at: i + 1, of: legs.length };
}
