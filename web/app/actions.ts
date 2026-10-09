"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountFor, sessionValue } from "@/lib/auth";
import { book, selection } from "@/lib/sportybet";

export type Leg = { eventId: string; market: string; kickoff: number };
export type BookResult =
  | { ok: true; code: string; legs: number; verified: number; skipped: number; lastKickoff: number }
  | { ok: false; error: string };

/** Turn the slip into a SportyBet booking code. Places no bet. */
export async function bookSlip(legs: Leg[]): Promise<BookResult> {
  const live = legs.filter((l) => l.kickoff > Date.now() + 2 * 60 * 1000);
  if (!live.length) return { ok: false, error: "Every leg has started or starts within 2 minutes. Refresh for the next round." };
  try {
    const res = await book(live.map((l) => selection(l.market, l.eventId)));
    return {
      ok: true, code: res.code, legs: live.length, verified: res.verified,
      skipped: legs.length - live.length, lastKickoff: Math.max(...live.map((l) => l.kickoff)),
    };
  } catch (e) {
    return { ok: false, error: `SportyBet did not create a code: ${(e as Error).message}. Try again in a minute.` };
  }
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
