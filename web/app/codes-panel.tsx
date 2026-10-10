"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { syncCodes } from "./profile-actions";
import { trackCodes } from "./push-actions";
import { CopyButton } from "./copy-button";
import { lagos } from "./pick-row";
import type { Tracked } from "@/lib/codes";
import type { SavedCode as Saved } from "@/lib/profile";
import { shareUrl } from "@/lib/share";

export type { Saved };
export const CODES_KEY = "vig_codes";
const SHOW = 24 * 3600 * 1000; // list a code until a day after its last kickoff

function readAll(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(CODES_KEY) ?? "[]") as Saved[];
  } catch {
    return [];
  }
}

function writeAll(list: Saved[]) {
  try {
    localStorage.setItem(CODES_KEY, JSON.stringify(list.slice(0, 60)));
  } catch { /* private mode */ }
}

const FINAL_KEY = "vig_code_final";
function readFinal(): Record<string, Tracked> {
  try {
    return JSON.parse(localStorage.getItem(FINAL_KEY) ?? "{}") as Record<string, Tracked>;
  } catch {
    return {};
  }
}
function saveFinal(ts: Tracked[]) {
  if (!ts.length) return;
  const all = { ...readFinal(), ...Object.fromEntries(ts.map((t) => [t.code, t])) };
  const keep = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].lastKickoff - a[1].lastKickoff).slice(0, 80));
  try { localStorage.setItem(FINAL_KEY, JSON.stringify(keep)); } catch { /* full or private */ }
}

export const readCodes = (): Saved[] => readAll().filter((c) => c.last + SHOW > Date.now());

/** Remember a code on this device and in the account, and tell the panel. */
export function rememberCode(c: Saved) {
  writeAll([c, ...readAll().filter((x) => x.code !== c.code)]);
  window.dispatchEvent(new Event("vig-codes"));
  syncCodes([c]).catch(() => undefined);
}

const ICON: Record<string, string> = { won: "✓", lost: "✗", playing: "…", waiting: "", unknown: "?" };
const STATE: Record<Tracked["state"], string> = { open: "In play", won: "Landed", lost: "Lost" };

export function CodesPanel() {
  const [codes, setCodes] = useState<Saved[]>([]);
  const [status, setStatus] = useState<Record<string, Tracked | { code: string; error: string }>>({});
  const [entry, setEntry] = useState("");
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<"all" | Tracked["state"]>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Settled codes never change, so they are kept on the device and not checked
  // again; the rest are checked in batches of 8, newest first.
  const refresh = useCallback((list: Saved[]) => {
    const done = readFinal();
    if (Object.keys(done).length) setStatus((s) => ({ ...done, ...s }));
    const todo = list.map((c) => c.code).filter((c) => !done[c]);
    if (!todo.length) return;
    start(async () => {
      for (let i = 0; i < todo.length; i += 8) {
        const res = await trackCodes(todo.slice(i, i + 8)).catch(() => []);
        setStatus((s) => ({ ...s, ...Object.fromEntries(res.map((r) => [r.code, r])) }));
        saveFinal(res.flatMap((r) => ("legs" in r && r.state !== "open" ? [r] : [])));
      }
    });
  }, []);

  useEffect(() => {
    const load = () => {
      const list = readCodes();
      setCodes(list);
      refresh(list);
    };
    load();
    // Share codes across the account's devices: merge this device's with the account's.
    syncCodes(readAll())
      .then((merged) => {
        if (!merged) return;
        writeAll(merged);
        load();
      })
      .catch(() => undefined);
    window.addEventListener("vig-codes", load);
    const t = setInterval(() => document.visibilityState === "visible" && refresh(readCodes()), 60_000);
    return () => {
      window.removeEventListener("vig-codes", load);
      clearInterval(t);
    };
  }, [refresh]);

  const track = (e: React.FormEvent) => {
    e.preventDefault();
    const code = entry.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return;
    start(async () => {
      const [r] = await trackCodes([code]);
      setStatus((s) => ({ ...s, [code]: r }));
      if ("legs" in r) rememberCode({ code, at: Date.now(), legs: r.legs.length, odds: r.odds ?? 0, last: r.lastKickoff });
      setEntry("");
    });
  };

  const tracked = codes.map((c) => ({ c, t: status[c.code] && "legs" in status[c.code] ? (status[c.code] as Tracked) : null }));
  const count = (st: Tracked["state"]) => tracked.filter((x) => x.t?.state === st).length;
  const shown = tracked.filter((x) => filter === "all" || x.t?.state === filter);
  const toggle = (code: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(code)) n.delete(code);
    else n.add(code);
    return n;
  });
  const FILTERS: [typeof filter, string][] = [["all", `All ${codes.length}`], ["open", `In play ${count("open")}`],
    ["won", `Landed ${count("won")}`], ["lost", `Lost ${count("lost")}`]];

  return (
    <section id="codes" className="codes-block" aria-labelledby="codes-title">
      <form className="row track" onSubmit={track}>
        <label className="field">Track any code
          <input type="text" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="e.g. GGQH9D"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Checking…" : "Track"}</button>
      </form>

      {codes.length > 0 && (
        <div className="codefilters" role="radiogroup" aria-label="Show codes" id="codes-title">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => setFilter(v)}>{label}</button>
          ))}
          <span className="muted">{pending ? "Updating…" : "Updates every minute"}</span>
        </div>
      )}
      {codes.length === 0 && <p className="note">No codes yet. Book a slip on Tonight or Our picks, or track any code above.</p>}

      {codes.length > 0 && !shown.length && <p className="note">No codes here.</p>}
      <ul className="codecards">
        {shown.map(({ c, t }) => {
          const err = status[c.code] && "error" in status[c.code];
          const legs = t?.legs ?? [];
          const next = legs.filter((l) => l.status === "waiting").sort((a, b) => a.kickoff - b.kickoff)[0];
          const left = legs.filter((l) => l.status === "waiting" || l.status === "playing").length;
          const isOpen = open.has(c.code);
          const odds = t ? t.odds : c.odds || null;
          return (
            <li key={c.code} className={`codecard ${t ? `is-${t.state}` : ""} ${isOpen ? "open" : ""}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) toggle(c.code); }}>
              <div className="codehead">
                <strong className="num codeid">{c.code}</strong>
                {t && <span className={`badge state-${t.state}`}>{STATE[t.state]}</span>}
                {err && <span className="badge state-lost">Unavailable</span>}
                <span className="codeodds">
                  {odds ? <><span className="num">{odds.toFixed(2)}</span> odds</> : <span title="Some legs were never seen before kickoff">odds unknown</span>}
                  {" · "}{legs.length || c.legs} legs
                </span>
              </div>
              {legs.length > 0 && (
                <div className="legbar" role="img" aria-label={`${t!.won} won, ${t!.lost} lost, ${left} to play`}>
                  {legs.map((l) => <span key={l.eventId} className={`seg seg-${l.status}`} />)}
                </div>
              )}
              <p className="codeline">
                {t ? <>{t.won} won · {t.lost} lost · {left} to play{next ? ` · next kickoff ${lagos(next.kickoff)}` : ""}</>
                  : err ? "SportyBet did not return this code." : "Checking…"}
                <span className="muted"> · booked {lagos(c.at)}</span>
              </p>
              <div className="row codeactions">
                <a className="button primary" href={shareUrl(c.code)}>Open in SportyBet</a>
                <CopyButton text={c.code} />
                {legs.length > 0 && (
                  <button type="button" className="legstoggle" aria-expanded={isOpen} onClick={() => toggle(c.code)}>
                    {isOpen ? "Hide legs ▴" : "Show legs ▾"}
                  </button>
                )}
              </div>
              {isOpen && legs.length > 0 && (
                <ol className="legs">
                  {legs.map((l) => (
                    <li key={l.eventId} className={`leg-${l.status}`}>
                      <span className="legicon" aria-hidden="true">{ICON[l.status]}</span>
                      <span>{l.home} v {l.away}
                        <small>{l.label} · {l.odds ? <>prematch <strong className="num">{l.odds.toFixed(2)}</strong></> : "prematch odds not seen"} · {lagos(l.kickoff)}</small>
                      </span>
                      <span className="legres">
                        {l.status === "waiting" ? lagos(l.kickoff) : l.status === "playing" ? "Playing" :
                          `${l.score}${l.market.startsWith("FH_") && l.ht ? ` (HT ${l.ht})` : ""}`}
                        <span className="sr-only"> {l.status}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
