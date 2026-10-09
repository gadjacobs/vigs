"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { syncCodes } from "./profile-actions";
import { trackCodes } from "./push-actions";
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

  return (
    <section id="codes" className="block codes-block" aria-labelledby="codes-title">
      <h2 id="codes-title">Your codes</h2>
      <p className="status">Codes booked on this device, with each leg as it settles. Results appear about 50 minutes after kickoff.</p>
      {codes.length === 0 && <p className="note">No codes yet. Book a slip above, or track any code below.</p>}
      <ul className="codes">
        {codes.map((c) => {
          const t = status[c.code];
          const tracked = t && "legs" in t ? t : null;
          return (
            <li key={c.code}>
              <details>
                <summary>
                  <strong className="num">{c.code}</strong>
                  <span>{c.legs} legs at {c.odds.toFixed(2)}</span>
                  {tracked && (
                    <span className={`badge state-${tracked.state}`}>
                      {STATE[tracked.state]}{tracked.state === "open" ? ` ${tracked.won}/${tracked.legs.length}` : ""}
                    </span>
                  )}
                  {t && "error" in t && <span className="badge state-lost">Unavailable</span>}
                </summary>
                {tracked && (
                  <ol className="legs">
                    {tracked.legs.map((l) => (
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
                )}
                <div className="row">
                  <a className="button" href={shareUrl(c.code)}>Open in SportyBet</a>
                  <span className="status">Booked {lagos(c.at)}, last kickoff {lagos(c.last)}</span>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <form className="row track" onSubmit={track}>
        <label className="field">Track a code
          <input type="text" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="e.g. GGQH9D"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Checking…" : "Track"}</button>
      </form>
    </section>
  );
}
