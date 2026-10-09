"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MARKET_GROUPS, MARKET_LABELS, SHORT_LABELS } from "@/lib/markets";
import { queryString, type Query } from "@/lib/query";

const ALL = Object.keys(MARKET_LABELS);
const TOLERANCES = [0.05, 0.1, 0.2];

export function Filters({ initial }: { initial: Query }) {
  const router = useRouter();
  const [q, setQ] = useState<Query>(initial);
  const [targetText, setTargetText] = useState(String(initial.target));
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof Query>(k: K, v: Query[K]) => setQ((x) => ({ ...x, [k]: v }));
  const toggle = (m: string) =>
    set("markets", q.markets.includes(m) ? q.markets.filter((x) => x !== m) : [...q.markets, m]);
  const target = Number(targetText.replace(",", "."));
  const targetOk = Number.isFinite(target) && target >= 1.1;
  const canBuild = q.markets.length > 0 && (q.mode === "count" || targetOk);
  const summary = q.markets.length === ALL.length ? "All markets"
    : q.markets.length === 0 ? "No market chosen"
    : q.markets.slice(0, 3).map((m) => SHORT_LABELS[m]).join(", ") + (q.markets.length > 3 ? ` +${q.markets.length - 3}` : "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canBuild) return;
    const qs = queryString({ ...q, target: targetOk ? target : q.target });
    document.cookie = `vig_q=${encodeURIComponent(qs)}; path=/; max-age=2592000; samesite=lax`;
    start(() => router.push(`/?${qs}&run=${Date.now()}`));
  };

  return (
    <form className="panel filters" onSubmit={submit} aria-busy={pending}>
      <div className="filter-row">
        <div className="segmented wide" role="radiogroup" aria-label="Build">
          <button type="button" role="radio" aria-checked={q.mode === "target"} onClick={() => set("mode", "target")}>To total odds</button>
          <button type="button" role="radio" aria-checked={q.mode === "count"} onClick={() => set("mode", "count")}>A number of picks</button>
        </div>
      </div>

      {q.mode === "target" ? (
        <div className="filter-row">
          <label className="field">Total odds
            <input type="text" inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value)}
              aria-invalid={!targetOk} placeholder="e.g. 20" className="big-input num" />
          </label>
          <div className="field">
            <span>Within</span>
            <div className="segmented" role="radiogroup" aria-label="Tolerance">
              {TOLERANCES.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={q.tol === t} onClick={() => set("tol", t)}>±{t * 100}%</button>
              ))}
            </div>
          </div>
          <label className="field">Games
            <select value={q.maxLegs} onChange={(e) => set("maxLegs", Number(e.target.value))}>
              <option value={0}>Any number</option>
              {[2, 3, 4, 5, 6, 8, 10, 15].map((n) => <option key={n} value={n}>Up to {n}</option>)}
            </select>
          </label>
          {targetOk && (
            <p className="hint">Builds the most likely slip priced {(target * (1 - q.tol)).toFixed(2)} to {(target * (1 + q.tol)).toFixed(2)}.</p>
          )}
        </div>
      ) : (
        <div className="filter-row">
          <label className="field">Picks
            <select value={q.count} onChange={(e) => set("count", Number(e.target.value))}>
              {[3, 5, 10, 15, 20, 30].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">Rank by
            <select value={q.sort} onChange={(e) => set("sort", e.target.value as Query["sort"])}>
              <option value="likely">Likelihood</option>
              <option value="edge">Edge</option>
            </select>
          </label>
        </div>
      )}

      <div className="markets-picker">
        <button type="button" className="summary-button" aria-expanded={marketsOpen} onClick={() => setMarketsOpen((o) => !o)}>
          <span className="muted">Markets</span> <strong>{summary}</strong>
          <span aria-hidden="true" className="chev">{marketsOpen ? "Hide" : "Change"}</span>
        </button>
        {marketsOpen && (
          <div className="market-panel">
            <div className="row">
              <button type="button" onClick={() => set("markets", ALL)}>All</button>
              <button type="button" onClick={() => set("markets", [])}>None</button>
            </div>
            {MARKET_GROUPS.map((g) => (
              <fieldset key={g.title} className="chipgroup">
                <legend>{g.title}</legend>
                {g.markets.map(([k, label]) => (
                  <label key={k} className="chip">
                    <input type="checkbox" checked={q.markets.includes(k)} onChange={() => toggle(k)} />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        )}
      </div>

      <details className="more-filters">
        <summary>More filters</summary>
        <div className="filter-row">
          <label className="field">Window
            <select value={q.hours} onChange={(e) => set("hours", Number(e.target.value))}>
              {[0.5, 1, 2, 3, 4].map((h) => <option key={h} value={h}>Next {h} h</option>)}
            </select>
          </label>
          <label className="field">Leg odds from
            <input type="text" inputMode="decimal" defaultValue={q.minOdds > 1.01 ? q.minOdds : ""} placeholder="1.01"
              onChange={(e) => set("minOdds", Number(e.target.value) || 1.01)} />
          </label>
          <label className="field">to
            <input type="text" inputMode="decimal" defaultValue={q.maxOdds < 100 ? q.maxOdds : ""} placeholder="any"
              onChange={(e) => set("maxOdds", Number(e.target.value) || 100)} />
          </label>
          <label className="field">Lowest grade
            <select value={q.minGrade} onChange={(e) => set("minGrade", e.target.value as Query["minGrade"])}>
              <option value="Rough">Rough</option>
              <option value="Lean">Lean</option>
            </select>
          </label>
        </div>
      </details>

      <div className="row">
        <button className="primary" type="submit" disabled={!canBuild || pending}>{pending ? "Building…" : "Build slip"}</button>
        {!q.markets.length && <span className="status" style={{ margin: 0 }}>Choose at least one market.</span>}
        {q.mode === "target" && !targetOk && <span className="status" style={{ margin: 0 }}>Enter total odds of 1.1 or more.</span>}
      </div>
    </form>
  );
}
