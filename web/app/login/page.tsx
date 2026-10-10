import { LoginPanel } from "./login-panel";
import { accounts, googleEnabled } from "@/lib/auth";

const ERRORS: Record<string, string> = {
  age: "Vig is for people aged 18 and over.",
  password: "That password is not right. Try again.",
  google: "Google sign-in did not complete. Try again.",
  notallowed: "That Google account is not on this app's list. Ask the owner to add it.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return (
    <main className="login-page">
      <div className="login-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" width={72} height={72} />
        <h1>Vig</h1>
        <p className="login-tag">vFootball picks from the numbers, priced live.</p>
      </div>
      <ul className="login-points">
        <li><strong>Cooked slips</strong> for every round, booked and ready to open in SportyBet.</li>
        <li><strong>A chance for every pick</strong>, from the bookmaker&apos;s price and a month of results.</li>
        <li><strong>An honest record</strong>: every pick logged before kickoff and scored after.</li>
      </ul>
      {err && ERRORS[err] && <p className="note warn" role="alert">{ERRORS[err]}</p>}
      <LoginPanel google={googleEnabled()} passwords={accounts().length > 0} />
      <p className="login-small">
        Personal tool for adults. Vig never places bets and never asks for your SportyBet details. Chances are estimates, not promises.
      </p>
    </main>
  );
}
