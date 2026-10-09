"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { book, selection } from "@/lib/sportybet";

type SlipLeg = { id: string; kickoff: number; odds: number; est: number; mkt: number };

/** Turn the picks on screen into a SportyBet booking code. Places no bet. */
export async function bookPicks(formData: FormData) {
  const market = String(formData.get("market"));
  const qs = String(formData.get("qs") ?? "");
  const legs = (JSON.parse(String(formData.get("slip") ?? "[]")) as SlipLeg[]).filter(
    (l) => l.kickoff > Date.now() + 2 * 60 * 1000,
  );
  const params = new URLSearchParams(qs);
  if (!legs.length) {
    params.set("err", "Every pick has started or starts within 2 minutes. Refresh for the next round.");
    redirect(`/?${params}`);
  }
  let target: string;
  try {
    const res = await book(legs.map((l) => selection(market, l.id)));
    const prod = (f: (l: SlipLeg) => number) => legs.reduce((a, l) => a * f(l), 1);
    params.set("code", res.code);
    params.set("n", String(legs.length));
    params.set("ok", String(res.verified));
    params.set("last", String(Math.max(...legs.map((l) => l.kickoff))));
    params.set("ao", prod((l) => l.odds).toFixed(2));
    params.set("ae", prod((l) => l.est).toFixed(6));
    params.set("am", prod((l) => l.mkt).toFixed(6));
    params.delete("err");
    target = `/?${params}`;
  } catch (e) {
    params.set("err", `SportyBet did not create a code: ${(e as Error).message}. Try again in a minute.`);
    target = `/?${params}`;
  }
  redirect(target);
}

async function digest(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vig:${s}`));
  return Buffer.from(buf).toString("hex");
}

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const adult = formData.get("adult") === "on";
  const expected = process.env.APP_PASSWORD ?? "";
  if (!adult) redirect("/login?err=age");
  if (!expected || password !== expected) redirect("/login?err=password");
  (await cookies()).set("vig_auth", await digest(expected), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}
