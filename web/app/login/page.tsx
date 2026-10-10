import { login } from "../actions";
import { accounts, googleEnabled } from "@/lib/auth";

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const google = googleEnabled();
  const passwords = accounts().length > 0;
  return (
    <main>
      <h1>Sign in</h1>
      {err === "age" && <p className="note warn" role="alert">Vig is for people aged 18 and over.</p>}
      {err === "password" && <p className="note warn" role="alert">That password is not right. Try again.</p>}
      {err === "google" && <p className="note warn" role="alert">Google sign-in did not complete. Try again.</p>}
      {err === "notallowed" && <p className="note warn" role="alert">That Google account is not on this app&apos;s list. Ask the owner to add it.</p>}
      {google && (
        <form action="/api/auth/google" method="get" className="panel login">
          <label>
            <input type="checkbox" name="adult" required /> <span>I am 18 or older</span>
          </label>
          <button className="primary" type="submit">Continue with Google</button>
        </form>
      )}
      {google && passwords && <p className="status orline">or use a password</p>}
      {passwords && (
        <form action={login} className="panel login">
          <label className="field" htmlFor="password">
            <span>Password</span>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </label>
          <label>
            <input type="checkbox" name="adult" required /> <span>I am 18 or older</span>
          </label>
          <button className={google ? "" : "primary"} type="submit">Sign in</button>
        </form>
      )}
    </main>
  );
}
