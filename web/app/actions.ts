"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accountFor, sessionValue } from "@/lib/auth";
import { book, selection } from "@/lib/sportybet";

export type Leg = { eventId: string; market: string; kickoff: number };
export type BookResult =
  | { ok: true; code: string; legs: number; verified: number; started: number; lastKickoff: number }
  | { ok: false; error: string };

/** Turn the slip into a SportyBet booking code. Places no bet. Every leg goes
 * in, including matches that have kicked off: SportyBet accepts them in a code,
 * and the slip in SportyBet shows which it will still take. */
export async function bookSlip(legs: Leg[]): Promise<BookResult> {
  if (!legs.length) return { ok: false, error: "The slip is empty." };
  try {
    const res = await book(legs.map((l) => selection(l.market, l.eventId)));
    return {
      ok: true, code: res.code, legs: legs.length, verified: res.verified,
      started: legs.filter((l) => l.kickoff <= Date.now()).length, lastKickoff: Math.max(...legs.map((l) => l.kickoff)),
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
