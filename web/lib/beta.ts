import { getJson, setJson } from "./store";

// Beta: invites and feedback, kept in the store.
// ADMIN_ACCOUNTS="me,ada" names the accounts that can invite testers and answer
// feedback (default: "me", the APP_PASSWORD account).

export const isAdmin = (user: string | null, env: Record<string, string | undefined> = process.env) =>
  Boolean(user) && (env.ADMIN_ACCOUNTS ?? "me").split(",").map((x) => x.trim()).includes(user!);

const accountName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32);

// ---- Invites: Google addresses let in without changing GOOGLE_ACCOUNTS ----

export type Invite = { email: string; account: string; by: string; at: number };

export const invites = async () => (await getJson<Invite[]>("invites")) ?? [];

export async function invitedAccount(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  return (await invites()).find((i) => i.email === e)?.account ?? null;
}

export async function addInvite(email: string, account: string, by: string): Promise<Invite[]> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("That is not an email address.");
  const name = accountName(account || e.split("@")[0]);
  const list = (await invites()).filter((i) => i.email !== e);
  list.push({ email: e, account: name, by, at: Date.now() });
  await setJson("invites", list.slice(-200));
  return list;
}

export async function removeInvite(email: string): Promise<Invite[]> {
  const e = email.trim().toLowerCase();
  const list = (await invites()).filter((i) => i.email !== e);
  await setJson("invites", list);
  return list;
}

// ---- Feedback: ideas and bugs, with votes and an answer ----

export type IdeaStatus = "new" | "planned" | "done" | "declined";
export type Idea = {
  id: string; kind: "idea" | "bug"; title: string; body: string; by: string; at: number;
  votes: string[]; status: IdeaStatus; reply?: string;
};

export const ideas = async () => (await getJson<Idea[]>("ideas")) ?? [];

const clip = (s: string, n: number) => String(s ?? "").trim().slice(0, n);

export async function addIdea(user: string, kind: Idea["kind"], title: string, body: string): Promise<Idea> {
  const t = clip(title, 120);
  if (t.length < 4) throw new Error("Give it a short title.");
  const idea: Idea = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: kind === "bug" ? "bug" : "idea", title: t, body: clip(body, 2000), by: user, at: Date.now(),
    votes: [user], status: "new",
  };
  await setJson("ideas", [...(await ideas()), idea].slice(-500));
  return idea;
}

export async function toggleVote(user: string, id: string): Promise<Idea[]> {
  const list = await ideas();
  const i = list.find((x) => x.id === id);
  if (!i) return list;
  i.votes = i.votes.includes(user) ? i.votes.filter((v) => v !== user) : [...i.votes, user];
  await setJson("ideas", list);
  return list;
}

export async function answerIdea(id: string, status: IdeaStatus, reply: string): Promise<Idea[]> {
  const list = await ideas();
  const i = list.find((x) => x.id === id);
  if (i) {
    i.status = status;
    i.reply = clip(reply, 1000) || undefined;
    await setJson("ideas", list);
  }
  return list;
}
