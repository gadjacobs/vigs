"use client";
import { useRef, useState, useTransition } from "react";
import { answer, submitIdea, voteIdea } from "../beta-actions";
import type { Idea, IdeaStatus } from "@/lib/beta";

const STATUS: Record<IdeaStatus, string> = { new: "New", planned: "Planned", done: "Done", declined: "Not now" };

export function IdeaForm() {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} className="panel ideaform" action={(fd) => start(async () => {
      const r = await submitIdea(fd);
      setMsg(r.ok ? "Thanks, it's on the list." : r.error ?? "That didn't go through.");
      if (r.ok) form.current?.reset();
    })}>
      <fieldset className="kindpick">
        <legend className="sr-only">Kind</legend>
        <label><input type="radio" name="kind" value="idea" defaultChecked /><span>Idea</span></label>
        <label><input type="radio" name="kind" value="bug" /><span>Bug</span></label>
      </fieldset>
      <label className="field">Title<input name="title" required minLength={4} maxLength={120} placeholder="e.g. Show each leg's odds on the share card" /></label>
      <label className="field">Details (optional)<textarea name="body" rows={3} maxLength={2000} placeholder="What should it do, or what happened?" /></label>
      <button className="primary" type="submit" disabled={pending}>{pending ? "Sending…" : "Send"}</button>
      {msg && <p className="status" role="status">{msg}</p>}
    </form>
  );
}

export function IdeaRow({ idea, me, admin }: { idea: Idea; me: string; admin: boolean }) {
  const [pending, start] = useTransition();
  const mine = idea.votes.includes(me);
  const [status, setStatus] = useState<IdeaStatus>(idea.status);
  const [reply, setReply] = useState(idea.reply ?? "");
  return (
    <li className={`idea st-${idea.status}`}>
      <button type="button" className={`votebtn ${mine ? "on" : ""}`} aria-pressed={mine} disabled={pending}
        aria-label={`${mine ? "Remove your vote for" : "Vote for"} ${idea.title}`} onClick={() => start(() => voteIdea(idea.id))}>
        <span aria-hidden="true">▲</span><b className="num">{idea.votes.length}</b>
      </button>
      <div className="ideamain">
        <p className="ideahead">
          <span className={`badge kind-${idea.kind}`}>{idea.kind === "bug" ? "Bug" : "Idea"}</span>
          <span className={`badge state-${idea.status}`}>{STATUS[idea.status]}</span>
        </p>
        <h3>{idea.title}</h3>
        {idea.body && <p className="ideabody">{idea.body}</p>}
        <p className="muted ideaby">{idea.by} · {new Date(idea.at).toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}</p>
        {idea.reply && <p className="note ideareply"><b>Vig:</b> {idea.reply}</p>}
        {admin && (
          <form className="ideaadmin" action={() => start(() => answer(idea.id, status, reply))}>
            <select value={status} onChange={(e) => setStatus(e.target.value as IdeaStatus)} aria-label="Status">
              {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply (optional)" aria-label="Reply" />
            <button type="submit" disabled={pending}>Save</button>
          </form>
        )}
      </div>
    </li>
  );
}
