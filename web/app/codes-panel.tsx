"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { hideCode, syncCodes } from "./profile-actions";
import { ShareButton } from "./share-sheet";
import { trackCodes } from "./push-actions";
import { liveCodes } from "./live-actions";
import { HedgeSheet, type HedgeLeg } from "./hedge-sheet";
import type { LiveLeg } from "@/lib/live";
import { CopyButton } from "./copy-button";
import { lagos } from "./pick-row";
import type { Tracked } from "@/lib/codes";
import type { SavedCode as Saved } from "@/lib/profile";
import { shareUrl } from "@/lib/share";

export type { Saved };
export const CODES_KEY = "vig_codes";
const PAGE = 10;
const DAY = 24 * 3600 * 1000;

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

const HIDDEN_KEY = "vig_codes_hidden";
function readHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeHidden(h: Set<string>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...h].slice(-300))); } catch { /* private mode */ }
}

/** Every code on this device except removed ones, newest first. */
export const readCodes = (): Saved[] => {
  const hidden = readHidden();
  return readAll().filter((c) => !hidden.has(c.code)).sort((a, b) => b.at - a.at);
};

/** Remember a code on this device and in the account, and tell the panel. */
export function rememberCode(c: Saved) {
  const hidden = readHidden();
  if (hidden.delete(c.code)) { writeHidden(hidden); hideCode(c.code, true).catch(() => undefined); }
  writeAll([c, ...readAll().filter((x) => x.code !== c.code)]);
  window.dispatchEvent(new Event("vig-codes"));
  syncCodes([c]).catch(() => undefined);
}

// Slip chance over time, per code, for the swing line. Kept on the device.
type Swing = Record<string, [number, number][]>;
const SWING_KEY = "vig_swing";
function readSwing(): Swing {
  try {
    return JSON.parse(localStorage.getItem(SWING_KEY) ?? "{}") as Swing;
  } catch {
    return {};
  }
}
function saveSwing(sw: Swing) {
  const keep = Object.entries(sw).sort((a, b) => (b[1].at(-1)?.[0] ?? 0) - (a[1].at(-1)?.[0] ?? 0)).slice(0, 40);
  try { localStorage.setItem(SWING_KEY, JSON.stringify(Object.fromEntries(keep))); } catch { /* full or private */ }
}

const legKey = (l: { eventId: string; market: string }) => `${l.eventId}|${l.market}`;

/** A leg's status with live scores applied: an over that has gone over has landed. */
function effective(l: Tracked["legs"][number], live: Record<string, LiveLeg>): Tracked["legs"][number]["status"] {
  const x = live[legKey(l)];
  if (l.status === "won" || l.status === "lost" || !x) return l.status;
  if (x.chance === 1 && x.state === "playing") return "won";
  if (x.chance === 0 && x.state === "playing") return "lost";
  return x.state === "playing" ? "playing" : l.status;
}

/** Chance the whole code lands now; null until every open leg has one. */
function codeChance(t: Tracked, live: Record<string, LiveLeg>): number | null {
  let p = 1;
  for (const l of t.legs) {
    const st = effective(l, live);
    if (st === "won") continue;
    if (st === "lost") return 0;
    const c = live[legKey(l)]?.chance;
    if (c === undefined || c === null) return null;
    p *= c;
  }
  return p;
}

function Spark({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null;
  const t0 = points[0][0], t1 = points.at(-1)![0] || t0 + 1;
  const xy = points.map(([t, c]) => `${((t - t0) / Math.max(1, t1 - t0)) * 100},${(1 - c) * 24 + 2}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={xy} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const ICON: Record<string, string> = { won: "✓", lost: "✗", playing: "…", waiting: "", unknown: "?" };
const STATE: Record<Tracked["state"] | "upcoming", string> = { upcoming: "Upcoming", open: "In play", won: "Landed", lost: "Lost" };

export function CodesPanel({ stake = 1000 }: { stake?: number }) {
  const [codes, setCodes] = useState<Saved[]>([]);
  const [status, setStatus] = useState<Record<string, Tracked | { code: string; error: string }>>({});
  const [entry, setEntry] = useState("");
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"open" | "history">("open");
  const [filter, setFilter] = useState<"all" | "won" | "lost">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState(1);
  const [undo, setUndo] = useState<Saved | null>(null);
  const [live, setLive] = useState<Record<string, LiveLeg>>({});
  const [swing, setSwing] = useState<Swing>({});
  const [hedge, setHedge] = useState<{ code: string; leg: HedgeLeg; odds: number | null } | null>(null);
  const closeHedge = useCallback(() => setHedge(null), []);
  const statusRef = useRef(status);
  statusRef.current = status;
  const checked = useRef<Record<string, number>>({});
  const lastLive = useRef(0);

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

  // Live scores and chances for open codes: every 10 seconds while a leg is in
  // play, every minute otherwise. A code whose leg has ended, or is already
  // beaten, is read again from SportyBet so it settles without waiting.
  const pollLive = useCallback(async (force = false) => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    const open = Object.values(statusRef.current).filter((t): t is Tracked => "legs" in t && t.state === "open");
    const legs = open.flatMap((t) => t.legs.filter((l) => l.status === "waiting" || l.status === "playing"));
    if (!legs.length) return;
    const playing = legs.some((l) => l.kickoff <= now);
    if (!force && !playing && now - lastLive.current < 60_000) return;
    lastLive.current = now;
    const res = await liveCodes(legs.map((l) => ({ eventId: l.eventId, market: l.market, kickoff: l.kickoff }))).catch(() => null);
    if (!res) return;
    setLive(res);
    const sw = readSwing();
    const again: string[] = [];
    for (const t of open) {
      const c = codeChance(t, res);
      const h = sw[t.code] ?? [];
      if (c !== null && (!h.length || Math.abs(h.at(-1)![1] - c) > 0.0005)) sw[t.code] = [...h, [now, c] as [number, number]].slice(-120);
      const ended = t.legs.some((l) => { const x = res[legKey(l)]; return x && (x.state === "ended" || (x.state === "playing" && x.chance === 0)); });
      if (ended && now - (checked.current[t.code] ?? 0) > 30_000) { checked.current[t.code] = now; again.push(t.code); }
    }
    saveSwing(sw);
    setSwing(sw);
    if (again.length) {
      const r = await trackCodes(again).catch(() => []);
      setStatus((s) => ({ ...s, ...Object.fromEntries(r.map((x) => [x.code, x])) }));
      saveFinal(r.flatMap((x) => ("legs" in x && x.state !== "open" ? [x] : [])));
    }
  }, []);

  const haveStatus = Object.keys(status).length > 0;
  useEffect(() => {
    setSwing(readSwing());
    if (!haveStatus) return;
    pollLive(true);
    const t = setInterval(() => pollLive(), 10_000);
    return () => clearInterval(t);
  }, [haveStatus, pollLive]);

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

  const now = Date.now();
  const tracked = codes.map((c) => {
    const st = status[c.code];
    return { c, t: st && "legs" in st ? st : null, err: Boolean(st && "error" in st) };
  });
  // Open: still in play, or not checked yet. History: settled, or no longer
  // available from SportyBet a day after the last kickoff.
  const isHistory = (x: (typeof tracked)[number]) => (x.t ? x.t.state !== "open" : x.err && x.c.last + DAY < now);
  const openList = tracked.filter((x) => !isHistory(x));
  const history = tracked.filter(isHistory);
  const shownHistory = history.filter((x) => filter === "all" || x.t?.state === filter);
  const list = tab === "open" ? openList.slice(0, pages * PAGE) : shownHistory.slice(0, pages * PAGE);
  const more = (tab === "open" ? openList.length : shownHistory.length) - list.length;
  const toggle = (code: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(code)) n.delete(code);
    else n.add(code);
    return n;
  });
  const remove = (c: Saved) => {
    const h = readHidden();
    h.add(c.code);
    writeHidden(h);
    setCodes(readCodes());
    setUndo(c);
    hideCode(c.code).catch(() => undefined);
    setTimeout(() => setUndo((u) => (u?.code === c.code ? null : u)), 6000);
  };
  const restore = () => {
    if (!undo) return;
    const h = readHidden();
    h.delete(undo.code);
    writeHidden(h);
    hideCode(undo.code, true).catch(() => undefined);
    setCodes(readCodes());
    setUndo(null);
  };
  const count = (st: "won" | "lost") => history.filter((x) => x.t?.state === st).length;

  return (
    <section id="codes" className="codes-block" aria-labelledby="codes-title">
      <form className="row track" onSubmit={track}>
        <label className="field">Track any code
          <input type="text" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="e.g. GGQH9D"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" disabled={pending}>{pending ? "Checking…" : "Track"}</button>
      </form>

      <div className="codetabs" role="tablist" aria-label="Codes">
        <button type="button" role="tab" aria-selected={tab === "open"} onClick={() => { setTab("open"); setPages(1); }}>
          Open <span className="count">{openList.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => { setTab("history"); setPages(1); }}>
          History <span className="count">{history.length}</span>
        </button>
      </div>
      {tab === "history" && history.length > 0 && (
        <div className="codefilters" role="radiogroup" aria-label="Show settled codes">
          {([["all", `All ${history.length}`], ["won", `Landed ${count("won")}`], ["lost", `Lost ${count("lost")}`]] as const).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => { setFilter(v); setPages(1); }}>{label}</button>
          ))}
        </div>
      )}
      <p className="status codestatus">{pending ? "Updating…" : tab === "open" ? "Scores update every 10 seconds while a leg is in play." : "Settled codes. Removing one hides it here; the record keeps its result."}</p>
      {undo && <p className="note undo" role="status">Removed {undo.code}. <button type="button" onClick={restore}>Undo</button></p>}
      {tab === "open" && !openList.length && <p className="note">No open codes. Book a slip on Tonight or Our picks, or track any code above.</p>}
      {tab === "history" && !shownHistory.length && <p className="note">Nothing settled here yet.</p>}
      <ul className="codecards">
        {list.map(({ c, t, err }) => {
          const legs = t?.legs ?? [];
          const eff = (l: (typeof legs)[number]) => effective(l, live);
          const next = legs.filter((l) => eff(l) === "waiting").sort((a, b) => a.kickoff - b.kickoff)[0];
          const left = legs.filter((l) => eff(l) === "waiting" || eff(l) === "playing").length;
          const wonN = legs.filter((l) => eff(l) === "won").length, lostN = legs.filter((l) => eff(l) === "lost").length;
          const chance = t && t.state === "open" ? codeChance(t, live) : null;
          const hist = swing[c.code] ?? [];
          const prev = hist.length > 1 ? hist.at(-2)![1] : null;
          const delta = chance !== null && prev !== null ? Math.round((chance - prev) * 100) : 0;
          const last = t && t.state === "open" && !lostN && left === 1 ? legs.find((l) => eff(l) === "waiting" || eff(l) === "playing") : undefined;
          // "In play" only once a leg has kicked off; before that, "Upcoming".
          const started = legs.some((l) => l.kickoff <= now || l.status !== "waiting");
          const shownState = t ? (t.state === "open" && lostN ? "lost" : t.state === "open" && !started ? "upcoming" : t.state) : null;
          const isOpen = open.has(c.code);
          const odds = t ? t.odds : c.odds || null;
          return (
            <li key={c.code} className={`codecard ${shownState ? `is-${shownState}` : ""} ${isOpen ? "open" : ""}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) toggle(c.code); }}>
              <div className="codehead">
                <strong className="num codeid">{c.code}</strong>
                {shownState && <span className={`badge state-${shownState}`}>{STATE[shownState]}</span>}
                {err && <span className="badge state-lost">Unavailable</span>}
                <span className="codeodds">
                  {odds ? <><span className="num">{odds.toFixed(2)}</span> odds</> : <span title="Some legs were never seen before kickoff">odds unknown</span>}
                  {" · "}{legs.length || c.legs} legs
                </span>
              </div>
              {legs.length > 0 && (
                <div className="legbar" role="img" aria-label={`${wonN} won, ${lostN} lost, ${left} to play`}>
                  {legs.map((l) => <span key={l.eventId} className={`seg seg-${eff(l)}`} />)}
                </div>
              )}
              <p className="codeline">
                {t ? <>{wonN} won · {lostN} lost · {left} to play{next ? ` · next kickoff ${lagos(next.kickoff)}` : ""}</>
                  : err ? (c.last + DAY < now ? "No longer available from SportyBet." : "SportyBet did not return this code.") : "Checking…"}
                <span className="muted"> · booked {lagos(c.at)}</span>
              </p>
              {chance !== null && !lostN && (
                <div className="chanceline">
                  <span>Chance to land <strong className="num">{chance >= 0.995 && chance < 1 ? ">99" : chance > 0 && chance < 0.005 ? "<1" : Math.round(chance * 100)}%</strong>
                    {delta !== 0 && <span className={delta > 0 ? "up" : "down"}> {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}</span>}</span>
                  <Spark points={hist} />
                </div>
              )}
              <div className="row codeactions">
                <a className="button primary" href={shareUrl(c.code)}>Open in SportyBet</a>
                <CopyButton text={c.code} />
                {(t || !err) && <ShareButton code={c.code} />}
                {last && <button type="button" onClick={() => setHedge({ code: c.code, odds: t!.odds,
                  leg: { eventId: last.eventId, market: last.market, kickoff: last.kickoff, home: last.home, away: last.away, label: last.label } })}>Hedge</button>}
                {tab === "history" && <button type="button" className="danger-ghost" onClick={() => remove(c)} aria-label={`Remove ${c.code}`}>Remove</button>}
                {legs.length > 0 && (
                  <button type="button" className="legstoggle" aria-expanded={isOpen} onClick={() => toggle(c.code)}>
                    {isOpen ? "Hide legs ▴" : "Show legs ▾"}
                  </button>
                )}
              </div>
              {isOpen && legs.length > 0 && (
                <ol className="legs">
                  {legs.map((l) => {
                    const st = eff(l), x = live[legKey(l)];
                    return (
                    <li key={l.eventId} className={`leg-${st}`}>
                      <span className="legicon" aria-hidden="true">{ICON[st]}</span>
                      <span>{l.home} v {l.away}
                        <small>{l.label} · {l.odds ? <>prematch <strong className="num">{l.odds.toFixed(2)}</strong></> : "prematch odds not seen"} · {lagos(l.kickoff)}</small>
                      </span>
                      <span className="legres">
                        {l.status === "won" || l.status === "lost" ? `${l.score}${l.market.startsWith("FH_") && l.ht ? ` (HT ${l.ht})` : ""}`
                          : x?.state === "playing" && x.score ? <>{x.minute !== null ? <small>{x.phase === "HT" ? "HT" : `${x.minute}'`}</small> : null} {x.score}</>
                          : l.kickoff > now ? lagos(l.kickoff) : "Playing"}
                        {x && x.chance !== null && (st === "playing" || st === "waiting") && <small className="legchance">{Math.round(x.chance * 100)}%</small>}
                        <span className="sr-only"> {st}</span>
                      </span>
                    </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      {hedge && <HedgeSheet code={hedge.code} leg={hedge.leg} odds={hedge.odds} stake={stake} onClose={closeHedge} />}
      {more > 0 && <button type="button" className="moreb" onClick={() => setPages((p) => p + 1)}>Show {Math.min(more, PAGE)} more</button>}
    </section>
  );
}
