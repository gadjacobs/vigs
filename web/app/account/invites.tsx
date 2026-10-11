"use client";
import { useRef, useState, useTransition } from "react";
import { invite, uninvite } from "../beta-actions";
import type { Invite } from "@/lib/beta";

/** Admin: let a friend's Google address in, as their own account. */
export function Invites({ list }: { list: Invite[] }) {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  return (
    <section className="panel invites" aria-labelledby="inv-title">
      <h2 id="inv-title">Beta testers</h2>
      <p className="status">Each tester signs in with Google and gets their own account: codes, record, alerts and settings. No redeploy needed.</p>
      <form ref={form} className="row" action={(fd) => start(async () => {
        const r = await invite(fd);
        setMsg(r.ok ? "Invited. They can sign in with Google now." : r.error ?? "That didn't work.");
        if (r.ok) form.current?.reset();
      })}>
        <label className="field">Google email<input name="email" type="email" required placeholder="friend@gmail.com" /></label>
        <label className="field">Account name<input name="account" placeholder="ada (optional)" pattern="[a-zA-Z0-9_-]{1,32}" /></label>
        <button className="primary" type="submit" disabled={pending}>Invite</button>
      </form>
      {msg && <p className="status" role="status">{msg}</p>}
      {list.length > 0 && (
        <ul className="invitelist">
          {list.map((i) => (
            <li key={i.email}><span>{i.email}<small> as {i.account}</small></span>
              <button type="button" className="danger-ghost" disabled={pending} onClick={() => start(() => uninvite(i.email))}>Remove</button></li>
          ))}
        </ul>
      )}
      <p className="hint">Removing an invite stops new sign-ins; to end sessions already open, change AUTH_SECRET in Vercel.</p>
    </section>
  );
}
