"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountFor, sessionValue } from "@/lib/auth";
import { currentUser } from "@/lib/profile";
import { book, selection } from "@/lib/sportybet";
import { push, storeReady } from "@/lib/store";

export type Leg = {
  eventId: string; market: string; kickoff: number;
  // What Vig showed for the leg when it was booked, for the record.
  odds?: number; estimate?: number; marketChance?: number; lo?: number; hi?: number;
  home?: string; away?: string; league?: string;
};
export type BookResult =
  | { ok: true; code: string; legs: number; verified: number; started: number; lastKickoff: number }
  | { ok: false; error: string };

/** Turn the slip into a SportyBet booking code. Places no bet. Every leg goes
 * in, including matches that have kicked off: SportyBet accepts them in a code,
 * and the slip in SportyBet shows which it will still take. */
export async function bookSlip(legs: Leg[], origin = "tonight"): Promise<BookResult> {
  if (!legs.length) return { ok: false, error: "The slip is empty." };
  try {
    const res = await book(legs.map((l) => selection(l.market, l.eventId)));
    await logBooking(res.code, legs, origin).catch(() => undefined);
    return {
      ok: true, code: res.code, legs: legs.length, verified: res.verified,
      started: legs.filter((l) => l.kickoff <= Date.now()).length, lastKickoff: Math.max(...legs.map((l) => l.kickoff)),
    };
  } catch (e) {
    return { ok: false, error: `SportyBet did not create a code: ${(e as Error).message}. Try again in a minute.` };
  }
}

/** Append the booking, with the server's clock, to the code log the collector
 * copies into the ledger. Legs that had kicked off by then are not scored. */
async function logBooking(code: string, legs: Leg[], origin: string) {
  if (!storeReady()) return;
  const user = await currentUser();
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  await push("codelog", {
    code, user, origin: origin.slice(0, 40), booked_at: Date.now(),
    legs: legs.slice(0, 60).map((l) => ({
      event_id: String(l.eventId), market: String(l.market), kickoff: num(l.kickoff), odds: num(l.odds),
      estimate: num(l.estimate), market_prob: num(l.marketChance), ci_low: num(l.lo), ci_high: num(l.hi),
      home: String(l.home ?? ""), away: String(l.away ?? ""), league: String(l.league ?? ""),
    })),
  });
}

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const adult = formData.get("adult") === "on";
  if (!adult) redirect("/login?err=age");
  const account = accountFor(password);
  if (!account) redirect("/login?err=password");
  (await cookies()).set("vig_auth", await sessionValue(account), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete("vig_auth");
  redirect("/login");
}
