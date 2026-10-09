import { login } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return (
    <main>
      <h1>Sign in</h1>
      <form action={login} className="panel login">
        {err === "age" && <p className="note warn" role="alert">Vig is for people aged 18 and over.</p>}
        {err === "password" && <p className="note warn" role="alert">That password is not right. Try again.</p>}
        <label className="field" htmlFor="password">
          <span>Password</span>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </label>
        <label>
          <input type="checkbox" name="adult" required /> <span>I am 18 or older</span>
        </label>
        <button className="primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}
