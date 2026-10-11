"use server";
import { revalidatePath } from "next/cache";
import { addIdea, addInvite, answerIdea, isAdmin, removeInvite, toggleVote, type IdeaStatus } from "@/lib/beta";
import { currentUser } from "@/lib/profile";
import { send, type Sub } from "@/lib/push";
import { getJson, members, storeReady } from "@/lib/store";

async function who() {
  const user = await currentUser();
  if (!user || !storeReady()) throw new Error("Sign in first.");
  return user;
}

export async function submitIdea(form: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await who();
    const idea = await addIdea(user, form.get("kind") === "bug" ? "bug" : "idea", String(form.get("title") ?? ""), String(form.get("body") ?? ""));
    // Let the admins know, on the devices where they turned notifications on.
    for (const id of await members("subs").catch(() => [] as string[])) {
      const s = await getJson<Sub>(`sub:${id}`).catch(() => null);
      if (s?.user && isAdmin(s.user) && s.user !== user)
        await send(s, { title: `New ${idea.kind} from ${user}`, body: idea.title, url: "/feedback", tag: `idea-${idea.id}` }).catch(() => false);
    }
    revalidatePath("/feedback");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function voteIdea(id: string) {
  const user = await who();
  await toggleVote(user, id);
  revalidatePath("/feedback");
}

export async function answer(id: string, status: IdeaStatus, reply: string) {
  const user = await who();
  if (!isAdmin(user) || !["new", "planned", "done", "declined"].includes(status)) return;
  await answerIdea(id, status, reply);
  revalidatePath("/feedback");
}

export async function invite(form: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await who();
    if (!isAdmin(user)) return { ok: false, error: "Only an admin can invite testers." };
    await addInvite(String(form.get("email") ?? ""), String(form.get("account") ?? ""), user);
    revalidatePath("/account");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function uninvite(email: string) {
  const user = await who();
  if (!isAdmin(user)) return;
  await removeInvite(email);
  revalidatePath("/account");
}
