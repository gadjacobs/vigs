"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { syncCodes } from "./profile-actions";
import { trackCodes } from "./push-actions";
import { CopyButton } from "./copy-button";
import { lagos } from "./pick-row";
import type { Tracked } from "@/lib/codes";
import type { SavedCode as Saved } from "@/lib/profile";

export type { Saved };
export const CODES_KEY = "vig_codes";
const SHOW = 24 * 3600 * 1000; // list a code until a day after its last kickoff
export const shareUrl = (code: string) => `https://www.sportybet.com/ng/?shareCode=${code}`;

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

  const refresh = useCallback((list: Saved[]) => {
    if (!list.length) return;
    start(async () => {
      const res = await trackCodes(list.map((c) => c.code));
      setStatus((s) => ({ ...s, ...Object.fromEntries(res.map((r) => [r.code, r])) }));
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
      if ("legs" in r) rememberCode({ code, at: Date.now(), legs: r.legs.length, odds: r.odds, last: r.lastKickoff });
      setEntry("");
    });
  };

  const tracked = codes.map((c) => ({ c, t: status[c.code] && "legs" in status[c.code] ? (status[c.code] as Tracked) : null }));
  const count = (st: Tracked["state"]) => tracked.filter((x) => x.t?.state === st).length;

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
        <p className="codesum" id="codes-title">
          <span><strong className="num">{count("open")}</strong> in play</span>
          <span><strong className="num">{count("won")}</strong> landed</span>
          <span><strong className="num">{count("lost")}</strong> lost</span>
          <span className="muted">Updates every minute{pending ? "…" : ""}</span>
        </p>
      )}
      {codes.length === 0 && <p className="note">No codes yet. Book a slip on Tonight or Our picks, or track any code above.</p>}

      <ul className="codecards">
        {tracked.map(({ c, t }) => {
          const err = status[c.code] && "error" in status[c.code];
          const legs = t?.legs ?? [];
          const next = legs.filter((l) => l.status === "waiting").sort((a, b) => a.kickoff - b.kickoff)[0];
          const left = legs.filter((l) => l.status === "waiting" || l.status === "playing").length;
          return (
            <li key={c.code} className={`codecard ${t ? `is-${t.state}` : ""}`}>
              <div className="codehead">
                <strong className="num codeid">{c.code}</strong>
                {t && <span className={`badge state-${t.state}`}>{STATE[t.state]}</span>}
                {err && <span className="badge state-lost">Unavailable</span>}
                <span className="codeodds"><span className="num">{(t?.odds ?? c.odds).toFixed(2)}</span> odds · {legs.length || c.legs} legs</span>
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
              </div>
              {legs.length > 0 && (
                <details className="legsbox">
                  <summary>Legs</summary>
                  <ol className="legs">
                    {legs.map((l) => (
                      <li key={l.eventId} className={`leg-${l.status}`}>
                        <span className="legicon" aria-hidden="true">{ICON[l.status]}</span>
                        <span>{l.home} v {l.away}<small>{l.label} at {l.odds.toFixed(2)}</small></span>
                        <span className="legres">
                          {l.status === "waiting" ? lagos(l.kickoff) : l.status === "playing" ? "Playing" :
                            `${l.score}${l.market.startsWith("FH_") && l.ht ? ` (HT ${l.ht})` : ""}`}
                          <span className="sr-only"> {l.status}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
