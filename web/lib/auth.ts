// Accounts. ACCOUNTS="name:password,name2:password2" lists them; without it,
// APP_PASSWORD is one account named "me". With neither, the app is open and
// everyone is "me". The vig_auth cookie holds "name.token", where token is a
// hash of the name and that account's password, so changing a password signs
// that account out everywhere. Passwords must differ between accounts: the
// sign-in form asks only for the password.

export type Account = { name: string; password: string };

export function accounts(env: Record<string, string | undefined> = process.env): Account[] {
  const list = (env.ACCOUNTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      return { name: s.slice(0, i).trim().toLowerCase(), password: s.slice(i + 1) };
    })
    .filter((a) => /^[a-z0-9_-]{1,32}$/.test(a.name) && a.password);
  if (list.length) return list;
  return env.APP_PASSWORD ? [{ name: "me", password: env.APP_PASSWORD }] : [];
}

async function hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const sessionValue = async (a: Account) => `${a.name}.${await hex(`vig:${a.name}:${a.password}`)}`;

/** The account a vig_auth cookie belongs to, or null. */
export async function verify(cookie: string | undefined, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const list = accounts(env);
  if (!list.length) return "me";
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot > 0) {
    const a = list.find((x) => x.name === cookie.slice(0, dot));
    return a && cookie === (await sessionValue(a)) ? a.name : null;
  }
  // Cookies from before accounts: hash of APP_PASSWORD alone.
  if (env.APP_PASSWORD && cookie === (await hex(`vig:${env.APP_PASSWORD}`)))
    return list.find((x) => x.password === env.APP_PASSWORD)?.name ?? null;
  return null;
}

export function accountFor(password: string, env: Record<string, string | undefined> = process.env): Account | null {
  return accounts(env).find((a) => a.password === password) ?? null;
}
