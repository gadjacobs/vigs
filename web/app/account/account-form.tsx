"use client";
import { useState, useTransition } from "react";
import { deleteFilter, savePrefs } from "../profile-actions";
import type { Prefs, SavedFilter } from "@/lib/profile";

export function AccountForm({ initial, filters: f0 }: { initial: Required<Prefs>; filters: SavedFilter[] }) {
  const [p, setP] = useState(initial);
  const [filters, setFilters] = useState(f0);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => setMsg((await savePrefs(p)) ? "Saved." : "Could not save; try again."));
  };
  return (
    <>
      <form className="panel acct-form" onSubmit={save}>
        <label className="field">Display name
          <input type="text" value={p.name} maxLength={32} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="What Vig calls you" />
        </label>
        <label className="field">Usual stake (₦)
          <input type="text" inputMode="numeric" value={p.stake || ""} onChange={(e) => setP({ ...p, stake: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          <span className="hint">Slips and share text show what this returns if every leg lands.</span>
        </label>
        <label className="field">Open the app on
          <select value={p.home} onChange={(e) => setP({ ...p, home: e.target.value as Prefs["home"] & string })}>
            <option value="/">Tonight</option>
            <option value="/picks">Our picks</option>
            <option value="/codes">Codes</option>
          </select>
          <span className="hint">Used when you open Vig from your home screen.</span>
        </label>
        <div className="row">
          <button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          <span className="status" role="status">{msg}</span>
        </div>
      </form>
      <section className="panel acct-filters" aria-labelledby="sf">
        <h2 id="sf">Saved filters</h2>
        {!filters.length ? <p className="status">None yet. On Tonight, set your filters and tap “+ Save these filters”.</p> : (
          <ul>
            {filters.map((x) => (
              <li key={x.name}>
                <a href={`/?${x.qs}`}>{x.name}</a>
                <button type="button" className="danger-ghost" disabled={pending}
                  onClick={() => start(async () => { const n = await deleteFilter(x.name); if (n) setFilters(n); })}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
