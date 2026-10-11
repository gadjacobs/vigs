"use client";
import { useRef, useState, useTransition } from "react";
import { deleteFilter, savePrefs, saveView } from "../profile-actions";
import type { Prefs, SavedFilter } from "@/lib/profile";
import type { View } from "@/lib/view";

type Basics = { name: string; stake: number; home: NonNullable<Prefs["home"]> };

/** Display and defaults. Each change saves on its own, with a short "Saved". */
export function SettingsForm({ initial, view: v0 }: { initial: Basics; view: View }) {
  const [p, setP] = useState(initial);
  const [view, setView] = useState<View>(v0);
  const [msg, setMsg] = useState("");
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (ok: boolean) => {
    setMsg(ok ? "Saved" : "Couldn't save. Try again.");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(""), 1800);
  };
  const saveBasics = (next: Basics) => start(async () => flash(await savePrefs(next).catch(() => false)));
  const chooseView = (v: View) => {
    setView(v);
    document.cookie = `vig_view=${v}; path=/; max-age=31536000; samesite=lax`;
    start(async () => { await saveView(v).catch(() => undefined); flash(true); });
  };
  return (
    <>
      <section id="display" className="setcard" aria-labelledby="display-h">
        <h2 id="display-h">How much detail</h2>
        <div className="viewpick" role="radiogroup" aria-label="How much detail">
          <button type="button" role="radio" aria-checked={view === "simple"} onClick={() => chooseView("simple")}>
            <span className="vp-mock" aria-hidden="true">
              <b className="num">76%</b><i>chance</i><em className="num">1.28</em>
            </span>
            <strong>Simple</strong>
            <small>The chance, the odds and what it pays. Best for most people.</small>
          </button>
          <button type="button" role="radio" aria-checked={view === "detailed"} onClick={() => chooseView("detailed")}>
            <span className="vp-mock rich" aria-hidden="true">
              <b className="num">76%</b><i>range 71–80</i><em className="num">1.28</em>
              <span className="vp-bar"><span /><i /></span>
            </span>
            <strong>Rich</strong>
            <small>Adds break-even, the bookmaker&apos;s own chance, the range, edge and grade.</small>
          </button>
        </div>
      </section>

      <section id="defaults" className="setcard" aria-labelledby="defaults-h">
        <h2 id="defaults-h">Defaults</h2>
        <label className="field">Your name
          <input type="text" value={p.name} maxLength={32} placeholder="What Vig calls you"
            onChange={(e) => setP({ ...p, name: e.target.value })} onBlur={() => saveBasics(p)} />
        </label>
        <div className="field">
          <span>Usual stake</span>
          <div className="stakepick">
            {[200, 500, 1000, 2000, 5000].map((x) => (
              <button key={x} type="button" aria-pressed={p.stake === x}
                onClick={() => { const n = { ...p, stake: x }; setP(n); saveBasics(n); }}>₦{x.toLocaleString("en-NG")}</button>
            ))}
            <input type="text" inputMode="numeric" aria-label="Another stake in naira" value={p.stake || ""}
              onChange={(e) => setP({ ...p, stake: Number(e.target.value.replace(/\D/g, "")) || 0 })} onBlur={() => saveBasics(p)} />
          </div>
          <span className="hint">Slips show what this returns if every leg lands.</span>
        </div>
        <label className="field">Open the app on
          <select value={p.home} onChange={(e) => { const n = { ...p, home: e.target.value as Basics["home"] }; setP(n); saveBasics(n); }}>
            <option value="/">Tonight</option>
            <option value="/picks">Our picks</option>
            <option value="/codes">Codes</option>
          </select>
        </label>
      </section>
      <p className={`savedtoast ${msg ? "on" : ""}`} role="status" aria-live="polite">{msg}</p>
    </>
  );
}

export function SavedFilters({ initial }: { initial: SavedFilter[] }) {
  const [filters, setFilters] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <section id="filters" className="setcard acct-filters" aria-labelledby="sf">
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
  );
}
