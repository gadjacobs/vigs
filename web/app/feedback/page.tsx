import { ideas, isAdmin, type Idea } from "@/lib/beta";
import { currentUser } from "@/lib/profile";
import { storeReady } from "@/lib/store";
import { IdeaForm, IdeaRow } from "./ideas";

export const dynamic = "force-dynamic";

const ORDER: Record<Idea["status"], number> = { planned: 0, new: 1, done: 2, declined: 3 };

export default async function Feedback({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const user = await currentUser();
  const admin = isAdmin(user);
  const all = storeReady() ? await ideas().catch(() => []) : [];
  const open = show !== "closed";
  const list = all
    .filter((i) => (open ? i.status === "new" || i.status === "planned" : i.status === "done" || i.status === "declined"))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.votes.length - a.votes.length || b.at - a.at);
  return (
    <main>
      <h1>Ideas and bugs</h1>
      <p className="lede">Vig is in beta. Tell us what to build or what broke, and back the ideas you want most.</p>
      {!storeReady() ? <p className="note warn">Feedback needs the store (see Alerts, Setup check).</p> : <IdeaForm />}
      <nav className="pagetabs" aria-label="Ideas">
        <a href="/feedback" aria-current={open ? "page" : undefined}>Open <span className="count">{all.filter((i) => i.status === "new" || i.status === "planned").length}</span></a>
        <a href="/feedback?show=closed" aria-current={!open ? "page" : undefined}>Done or declined <span className="count">{all.filter((i) => i.status === "done" || i.status === "declined").length}</span></a>
      </nav>
      {!list.length && <p className="note">{open ? "Nothing open yet. Be the first." : "Nothing closed yet."}</p>}
      <ul className="ideas">
        {list.map((i) => <IdeaRow key={i.id} idea={i} me={user ?? ""} admin={admin} />)}
      </ul>
    </main>
  );
}
