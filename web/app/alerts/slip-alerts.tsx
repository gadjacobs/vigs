"use client";
import { useState, useTransition } from "react";
import { removeWatch, saveWatch } from "../profile-actions";
import type { SlipWatch } from "@/lib/watches";
import { impossible } from "@/lib/watch-rules";

const TEMPLATES: [string, string][] = [["template:trusted", "Most confident"], ["template:top", "Most likely"]];
const nameOf = (source: string) =>
  TEMPLATES.find(([v]) => v === source)?.[1] ?? (source.startsWith("filter:") ? `“${source.slice(7)}”` : source);

function describe(w: SlipWatch) {
  const tmpl = w.source.startsWith("template:");
  const parts = [tmpl ? `${w.minLegs} or more legs qualify` : `${w.minLegs} or more legs`];
  if (w.minLeg) parts.push(`each leg ${Math.round(w.minLeg * 100)}%+`);
  if (w.minChance) parts.push(`whole slip lands ${Math.round(w.minChance * 100)}%+`);
  if (w.minOdds) parts.push(`total odds ${w.minOdds}+`);
  return parts.join(", ");
}

/** Alerts when a saved Tonight filter or an Our picks template comes up with a slip
 * that meets your conditions. They belong to the account, so every device with
 * notifications on gets them. */
export function SlipAlerts({ initial, filters, preset }: { initial: SlipWatch[]; filters: string[]; preset?: { source: string; legs?: number } }) {
  const [list, setList] = useState(initial);
  const [source, setSource] = useState(preset?.source ?? TEMPLATES[0][0]);
  const [legs, setLegs] = useState(String(preset?.legs ?? (source.startsWith("template:") ? 20 : 3)));
  const [minChance, setMinChance] = useState("");
  const [minLeg, setMinLeg] = useState("");
  const [minOdds, setMinOdds] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const add = () => start(async () => {
    const r = await saveWatch({ id: "", source, minLegs: Number(legs), minChance: minChance ? Number(minChance) / 100 : undefined, minLeg: minLeg ? Number(minLeg) / 100 : undefined, minOdds: minOdds ? Number(minOdds) : undefined });
    if ("error" in r) return setMsg(r.error);
    setList(r);
    setMsg(`Saved. You'll hear when ${nameOf(source)} qualifies.`);
  });

  return (
    <div className="slipalerts">
      <p className="status">Get a notification when one of these comes up with a slip you&apos;d want: checked about every 10 minutes, at most once every 2 hours per alert and only when the slip has changed, never between midnight and 7am. Every device on your account with notifications on gets it.</p>
      {list.length > 0 && (
        <ul className="watchlist">
          {list.map((w) => (
            <li key={w.id}>
              <span><strong>{nameOf(w.source)}</strong><small>{describe(w)}</small>
                {impossible(w) && <small className="watchwarn">Can never fire. {impossible(w)} Remove it and add it again.</small>}</span>
              <button type="button" className="danger-ghost" disabled={pending}
                onClick={() => start(async () => { const r = await removeWatch(w.id); if (r) setList(r); })}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="watchform">
        <label className="field">Watch
          <select value={source} onChange={(e) => { setSource(e.target.value); setLegs(e.target.value.startsWith("template:") ? "20" : "3"); }}>
            <optgroup label="Our picks">
              {TEMPLATES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </optgroup>
            {filters.length > 0 && (
              <optgroup label="Your saved filters">
                {filters.map((f) => <option key={f} value={`filter:${f}`}>{f}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <div className="watchnums">
          <label className="field">{source.startsWith("template:") ? "Legs that qualify, at least" : "Legs, at least"}
            <input type="number" inputMode="numeric" min={1} max={50} value={legs} onChange={(e) => setLegs(e.target.value)} />
          </label>
          <label className="field">Each leg lands, at least (%)
            <input type="number" inputMode="decimal" min={5} max={99} placeholder="any" value={minLeg} onChange={(e) => setMinLeg(e.target.value)} />
          </label>
          <label className="field">Whole slip lands, at least (%)
            <input type="number" inputMode="decimal" min={0} max={99} placeholder="any" value={minChance} onChange={(e) => setMinChance(e.target.value)} />
          </label>
          <label className="field">Total odds, at least
            <input type="number" inputMode="decimal" min={1} placeholder="any" value={minOdds} onChange={(e) => setMinOdds(e.target.value)} />
          </label>
        </div>
        {(() => { const why = impossible({ minChance: minChance ? Number(minChance) / 100 : undefined, minOdds: minOdds ? Number(minOdds) : undefined }); return why ? <p className="note watchwarn" role="alert">{why}</p> : null; })()}
        {!filters.length && <p className="hint">Saved filters appear here once you save one on Tonight (“+ Save these filters”).</p>}
        <button type="button" className="primary" disabled={pending || Boolean(impossible({ minChance: minChance ? Number(minChance) / 100 : undefined, minOdds: minOdds ? Number(minOdds) : undefined }))} onClick={add}>{pending ? "Saving…" : "Add alert"}</button>
      </div>
      <p className="status" role="status" aria-live="polite">{msg}</p>
    </div>
  );
}
