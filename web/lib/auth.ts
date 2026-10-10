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
  if (!list.length && !googleEnabled(env)) return "me";
  if (!cookie) return null;
  if (cookie.includes(".g.")) return verifyGoogle(cookie, env);
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

// ---- Google sign-in ----
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from a Google Cloud OAuth client;
// AUTH_SECRET signs the session; GOOGLE_ACCOUNTS="you@gmail.com=me,friend@gmail.com=ada"
// lets those addresses in, each as the named account (so "me" keeps its data).
// GOOGLE_ALLOW_ANY=1 lets any verified Google address in as its own account.

export const googleEnabled = (env: Record<string, string | undefined> = process.env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_SECRET);

export function googleAccountFor(email: string, env: Record<string, string | undefined> = process.env): string | null {
  const e = email.trim().toLowerCase();
  for (const pair of (env.GOOGLE_ACCOUNTS ?? "").split(",")) {
    const [mail, name] = pair.split("=").map((x) => x?.trim().toLowerCase());
    if (mail && mail === e) return name && /^[a-z0-9_-]{1,32}$/.test(name) ? name : e.replace(/[^a-z0-9_-]/g, "_").slice(0, 32);
  }
  return env.GOOGLE_ALLOW_ANY === "1" ? e.replace(/[^a-z0-9_-]/g, "_").slice(0, 32) : null;
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Session cookie for a Google-signed-in account: "name.g.signature". */
export const googleSession = async (name: string, env: Record<string, string | undefined> = process.env) =>
  `${name}.g.${await hmac(env.AUTH_SECRET!, `vig-google:${name}`)}`;

/** Verifies a Google session cookie; the account must still be allowed. */
export async function verifyGoogle(cookie: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const m = /^([a-z0-9_-]{1,32})\.g\.([0-9a-f]{64})$/.exec(cookie);
  if (!m || !env.AUTH_SECRET) return null;
  const allowed = env.GOOGLE_ALLOW_ANY === "1" ||
    (env.GOOGLE_ACCOUNTS ?? "").split(",").some((p) => googleAccountFor(p.split("=")[0] ?? "", env) === m[1]);
  return allowed && (await hmac(env.AUTH_SECRET, `vig-google:${m[1]}`)) === m[2] ? m[1] : null;
}
