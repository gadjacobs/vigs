"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { hideCode, syncCodes } from "./profile-actions";
import { ShareButton } from "./share-sheet";
import { alertState, followMatch, setCodeAlertAction, trackCodes } from "./push-actions";
import { liveCodes } from "./live-actions";
import { HedgeSheet, type HedgeLeg } from "./hedge-sheet";
import type { LiveLeg } from "@/lib/live";
import { CopyButton } from "./copy-button";
import { lagos } from "./pick-row";
import type { Tracked } from "@/lib/codes";
import type { SavedCode as Saved } from "@/lib/profile";
import { shareUrl } from "@/lib/share";
import { isFinal, readAll, readCodes, readFinal, readHidden, readOpen, saveFinal, saveOpen, writeAll, writeHidden } from "./code-store";
import { flexLevels, FlexRow } from "./flex-row";

export type { Saved };
export { CODES_KEY, readCodes } from "./code-store";
const PAGE = 10;
const DAY = 24 * 3600 * 1000;

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

/** Each leg's chance for Flex: 1 or 0 once decided, else its live or market chance. */
function legProbs(t: Tracked, live: Record<string, LiveLeg>): number[] | null {
  const ps: number[] = [];
  for (const l of t.legs) {
    const st = effective(l, live);
    if (st === "won" || st === "lost") { ps.push(st === "won" ? 1 : 0); continue; }
    const c = live[legKey(l)]?.chance;
    if (c === undefined || c === null) return null;
    ps.push(c);
  }
  return ps;
}

/** The chance from the legs that are priced, and how many aren't yet (rounds SportyBet hasn't published). */
function chanceParts(t: Tracked, live: Record<string, LiveLeg>): { p: number; missing: number; settling: number } {
  let p = 1, missing = 0, settling = 0;
  for (const l of t.legs) {
    const st = effective(l, live);
    if (st === "won") continue;
    if (st === "lost") return { p: 0, missing: 0, settling: 0 };
    const x = live[legKey(l)];
    if (x?.state === "ended") settling++;
    else if (x?.chance === undefined || x.chance === null) missing++;
    else p *= x.chance;
  }
  return { p, missing: missing + settling, settling };
}

function SkeletonCard() {
  return (
    <li className="codecard skeleton" aria-hidden="true">
      <div className="codetop"><span className="skel skel-code" /><span className="skel skel-chance" /></div>
      <span className="skel skel-line short" />
      <span className="skel skel-bar" />
      <span className="skel skel-line" />
      <div className="codeactions"><span className="skel skel-btn" /><span className="skel skel-btn small" /></div>
    </li>
  );
}

const ALERT_MODES = [
  ["goals", "Every goal", "Each goal in any leg, then the result"],
  ["default", "Key moments", "The result, big swings and one leg left"],
  ["off", "Off", "Nothing for this code"],
] as const;

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

/** A number that rolls to its new value, and briefly shows which way it moved. */
function Ticker({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<"" | "up" | "down">("");
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    setDir(value > start ? "up" : "down");
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now(), dur = still ? 0 : 700;
    let raf = 0;
    const step = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const v = start + (value - start) * (1 - Math.pow(1 - k, 3));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    const off = setTimeout(() => setDir(""), 1800);
    return () => { cancelAnimationFrame(raf); clearTimeout(off); from.current = value; };
  }, [value]);
  const r = Math.round(shown);
  const text = value >= 99.5 && value < 100 ? ">99" : value > 0 && value < 0.5 ? "<1" : String(r);
  return <span className={`ticker ${dir}`}>{text}</span>;
}

const pctText = (p: number) => (p >= 0.995 && p < 1 ? ">99" : p > 0 && p < 0.005 ? "<1" : String(Math.round(p * 100)));

/** This device's push subscription endpoint, if notifications are on. */
async function pushEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

const BELL = "M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0";
const BELL_OFF = "M6 16V11a6 6 0 0110-4.5M18 11v5l2 2H8M10 20a2 2 0 004 0M3 3l18 18";
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const ICON: Record<string, string> = { won: "✓", lost: "✗", playing: "…", waiting: "", unknown: "?" };
const STATE: Record<Tracked["state"] | "upcoming", string> = { upcoming: "Upcoming", open: "In play", won: "Landed", lost: "Lost" };

export function CodesPanel({ stake = 1000, view = "simple" }: { stake?: number; view?: "simple" | "detailed" }) {
  const [codes, setCodes] = useState<Saved[]>([]);
  const [loaded, setLoaded] = useState(false);
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
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [modes, setModes] = useState<Record<string, "goals" | "off">>({});
  const [follows, setFollows] = useState<Set<string>>(new Set());
  const [goalFlash, setGoalFlash] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (m: string) => {
    setNote(m);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 3500);
  };
  const lastScores = useRef<Record<string, string>>({});
  const statusRef = useRef(status);
  statusRef.current = status;
  const checked = useRef<Record<string, number>>({});
  const lastLive = useRef(0);

  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const pollRef = useRef<(force?: boolean) => void>(() => undefined);

  // Settled codes never change, so they are kept on the device and not checked
  // again. Open ones show their last reading at once, marked as updating, and are
  // all read again together; live scores are fetched straight after.
  const refresh = useCallback((list: Saved[]) => {
    const done = readFinal();
    const todo = list.map((c) => c.code).filter((c) => !done[c]);
    const known = readOpen();
    const cached = Object.fromEntries(todo.flatMap((c) => (known[c] ? [[c, known[c]]] : [])));
    setStatus((s) => ({ ...done, ...cached, ...s }));
    if (!todo.length) return;
    setUpdating((u) => new Set([...u, ...todo]));
    void (async () => {
      const batches: string[][] = [];
      for (let i = 0; i < todo.length; i += 8) batches.push(todo.slice(i, i + 8));
      await Promise.all(batches.map(async (b) => {
        const res = await trackCodes(b).catch(() => []);
        setStatus((s) => ({ ...s, ...Object.fromEntries(res.map((r) => [r.code, r])) }));
        const ts = res.flatMap((r) => ("legs" in r ? [r] : []));
        saveFinal(ts.filter((r) => isFinal(r)));
        saveOpen(ts.filter((r) => !r.foreign));
        setUpdating((u) => new Set([...u].filter((c) => !b.includes(c))));
        statusRef.current = { ...statusRef.current, ...Object.fromEntries(res.map((r) => [r.code, r])) };
        pollRef.current(true);
      }));
    })();
  }, []);

  // Live scores and chances for open codes: every 10 seconds while a leg is in
  // play, every minute otherwise. A code whose leg has ended, or is already
  // beaten, is read again from SportyBet so it settles without waiting.
  const pollLive = useCallback(async (force = false) => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    // Open codes, and lost ones whose remaining legs a Flex slip still depends on.
    const open = Object.values(statusRef.current).filter((t): t is Tracked => "legs" in t && !isFinal(t) && t.lost <= 3);
    const legs = open.flatMap((t) => t.legs.filter((l) => l.status === "waiting" || l.status === "playing"));
    if (!legs.length) return;
    const playing = legs.some((l) => l.kickoff <= now);
    if (!force && !playing && now - lastLive.current < 60_000) return;
    lastLive.current = now;
    const res = await liveCodes(legs.map((l) => ({ eventId: l.eventId, market: l.market, kickoff: l.kickoff }))).catch(() => null);
    if (!res) return;
    setLive(res);
    // A changed score flashes for a few seconds.
    const fresh: string[] = [];
    for (const [k, x] of Object.entries(res)) {
      const id = k.split("|")[0];
      if (x.score && lastScores.current[id] !== undefined && lastScores.current[id] !== x.score) fresh.push(id);
      if (x.score) lastScores.current[id] = x.score;
    }
    if (fresh.length) {
      setGoalFlash((g) => new Set([...g, ...fresh]));
      setTimeout(() => setGoalFlash((g) => new Set([...g].filter((id) => !fresh.includes(id)))), 4000);
    }
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
      saveFinal(r.flatMap((x) => ("legs" in x && isFinal(x) ? [x] : [])));
      saveOpen(r.flatMap((x) => ("legs" in x && !x.foreign ? [x] : [])));
    }
  }, []);

  pollRef.current = (force = false) => { pollLive(force); };
  const haveStatus = Object.keys(status).length > 0;
  useEffect(() => {
    if (!haveStatus) return;
    (async () => {
      const ep = await pushEndpoint();
      setEndpoint(ep);
      if (!ep) return;
      const ts = Object.values(statusRef.current).filter((t): t is Tracked => "legs" in t);
      const st = await alertState(ep, ts.map((t) => t.code), ts.flatMap((t) => t.legs.map((l) => l.eventId))).catch(() => null);
      if (st) { setModes(st.modes); setFollows(new Set(st.matches)); }
    })();
  }, [haveStatus]);

  const chooseMode = (code: string, mode: "goals" | "off" | "default", lastKickoff: number) => {
    if (!endpoint) return;
    setModes((m) => { const n = { ...m }; if (mode === "default") delete n[code]; else n[code] = mode; return n; });
    setCodeAlertAction(endpoint, code, mode, lastKickoff).catch(() => undefined);
    say(mode === "goals" ? `${code}: every goal in every leg, then the result.` : mode === "off" ? `${code}: no notifications.` : `${code}: the result and big moments.`);
  };
  const toggleFollow = (l: Tracked["legs"][number]) => {
    if (!endpoint) return;
    const on = !follows.has(l.eventId);
    setFollows((f) => { const n = new Set(f); if (on) n.add(l.eventId); else n.delete(l.eventId); return n; });
    followMatch(endpoint, { eventId: l.eventId, home: l.home, away: l.away, league: l.league, kickoff: l.kickoff }, on).catch(() => undefined);
    say(on ? `Following ${l.home} v ${l.away}: kick-off, goals, half time and full time.` : `Stopped following ${l.home} v ${l.away}.`);
  };
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
      setLoaded(true);
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
    // Back in the foreground: re-read every open code and the live scores now.
    const resume = () => { refresh(readCodes().filter((c) => { const st = statusRef.current[c.code]; return !st || !("legs" in st) || !isFinal(st); })); pollLive(true); };
    window.addEventListener("vig-resume", resume);
    // Live scores come from the live feed; SportyBet's share endpoint is only
    // read again for codes not loaded yet, or with a leg that should be over.
    const stale = (c: Saved) => {
      const st = statusRef.current[c.code];
      if (!st || !("legs" in st)) return true;
      return !isFinal(st) && st.legs.some((l) => (l.status === "waiting" || l.status === "playing") && l.kickoff + 30 * 60_000 < Date.now());
    };
    const t = setInterval(() => document.visibilityState === "visible" && refresh(readCodes().filter(stale)), 60_000);
    return () => {
      window.removeEventListener("vig-codes", load);
      window.removeEventListener("vig-resume", resume);
      clearInterval(t);
    };
  }, [refresh, pollLive]);

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
  const isHistory = (x: (typeof tracked)[number]) => (x.t ? x.t.state !== "open" || x.t.foreign : x.err && x.c.last + DAY < now);
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
      <p className="status codestatus">{tab === "open" ? "Scores update every 10 seconds while a leg is in play." : "Settled codes. Removing one hides it here; the record keeps its result."}</p>
      {undo && <p className="note undo" role="status">Removed {undo.code}. <button type="button" onClick={restore}>Undo</button></p>}
      {!loaded && <ul className="codecards" aria-busy="true" aria-label="Loading codes"><SkeletonCard /><SkeletonCard /></ul>}
      {loaded && tab === "open" && !openList.length && <p className="note">No open codes. Book a slip on Tonight or Our picks, or track any code above.</p>}
      {tab === "history" && !shownHistory.length && <p className="note">Nothing settled here yet.</p>}
      <ul className="codecards">
        {list.map(({ c, t, err }) => {
          const legs = t?.legs ?? [];
          const eff = (l: (typeof legs)[number]) => effective(l, live);
          const next = legs.filter((l) => eff(l) === "waiting").sort((a, b) => a.kickoff - b.kickoff)[0];
          const left = legs.filter((l) => eff(l) === "waiting" || eff(l) === "playing").length;
          const wonN = legs.filter((l) => eff(l) === "won").length, lostN = legs.filter((l) => eff(l) === "lost").length;
          const parts = t && t.state === "open" && !t.foreign ? chanceParts(t, live) : null;
          const chance = parts && !parts.missing ? codeChance(t!, live) : null;
          const hist = swing[c.code] ?? [];
          const prev = hist.length > 1 ? hist.at(-2)![1] : null;
          const delta = chance !== null && prev !== null ? Math.round((chance - prev) * 100) : 0;
          const last = t && t.state === "open" && !lostN && left === 1 ? legs.find((l) => eff(l) === "waiting" || eff(l) === "playing") : undefined;
          // "In play" only once a leg has kicked off; before that, "Upcoming".
          const started = legs.some((l) => l.kickoff <= now || l.status !== "waiting");
          const shownState = t ? (t.state === "open" && lostN ? "lost" : t.state === "open" && !started ? "upcoming" : t.state) : null;
          const isOpen = open.has(c.code);
          const odds = t ? t.odds : c.odds || null;
          const mode = modes[c.code];
          const settled = t && t.state !== "open";
          const foreign = Boolean(t?.foreign);
          return (
            <li key={c.code} className={`codecard ${foreign ? "is-foreign" : shownState ? `is-${shownState}` : ""} ${isOpen ? "open" : ""}`}>
              <div className="codetop">
                <div className="codehead">
                  <strong className="num codeid">{c.code}</strong>
                  {foreign ? <span className="badge state-upcoming">Not vFootball</span>
                    : shownState && <span className={`badge state-${shownState}`}>{STATE[shownState]}</span>}
                  {err && <span className="badge state-lost">Unavailable</span>}
                  {updating.has(c.code) && <span className="updating" role="status"><i className="spin" aria-hidden="true" />Updating</span>}
                </div>
                {foreign ? null : chance !== null && !lostN ? (
                  <div className={`chancebig ${chance >= 0.5 ? "good" : "low"}`} aria-label={`${pctText(chance)}% chance to land`}>
                    <span className="num"><Ticker value={chance * 100} /><small>%</small></span>
                    <em>{delta !== 0 ? <b className={delta > 0 ? "up" : "down"}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)}</b> : null} to land</em>
                  </div>
                ) : parts && parts.missing && !lostN ? (
                  <div className="chancebig low" aria-label={`at most ${pctText(parts.p)}% chance to land`}>
                    <span className="num"><small>≤</small>{pctText(parts.p)}<small>%</small></span>
                    <em>{parts.missing - parts.settling ? `${parts.missing - parts.settling} not priced yet` : `${parts.settling} settling`}</em>
                  </div>
                ) : settled ? (
                  <div className={`chancebig done-${t!.state}`}><span>{t!.state === "won" ? "✓" : "✗"}</span><em>{t!.state === "won" ? "landed" : "lost"}</em></div>
                ) : null}
              </div>
              <p className="codemeta">
                {odds ? <><strong className="num">{odds.toFixed(2)}</strong> odds · </> : null}
                {legs.length || c.legs} legs · booked {lagos(c.at)}
              </p>
              {foreign ? (
                <p className="codeline">Vig follows vFootball only, so this code&apos;s results aren&apos;t tracked here. Check it in SportyBet.</p>
              ) : (<>
              {legs.length > 0 && (
                <div className="legbar" role="img" aria-label={`${wonN} won, ${lostN} lost, ${left} to play`}>
                  {legs.map((l) => <span key={l.eventId} className={`seg seg-${eff(l)} ${goalFlash.has(l.eventId) ? "flash" : ""}`} />)}
                </div>
              )}
              <p className="codeline">
                {t ? <><b>{wonN}</b> won · <b>{lostN}</b> lost · <b>{left}</b> to play{next ? <span className="muted"> · next {lagos(next.kickoff)}</span> : null}</>
                  : err ? (c.last + DAY < now ? "No longer available from SportyBet." : "SportyBet did not return this code.") : <span className="skel skel-line" aria-label="Loading" />}
              </p>
              {hist.length > 1 && chance !== null && !lostN && <Spark points={hist} />}
              {t && !foreign && legs.length >= 3 && lostN <= Math.max(...flexLevels(legs.length)) && (() => {
                const ps = legProbs(t, live);
                if (!ps) return null;
                const decided = left === 0;
                if (decided && lostN === 0) return null;
                const note = lostN === 0 ? undefined
                  : decided ? `${wonN} of ${legs.length} landed: played with Flex at ${wonN} of ${legs.length} or lower, this slip pays a reduced amount.`
                  : `${lostN} leg${lostN > 1 ? "s" : ""} lost. Played with Flex, this slip can still pay.`;
                return <FlexRow ps={ps} note={note} />;
              })()}
              </>)}
              <div className="codeactions">
                <a className="button primary" href={shareUrl(c.code)}>Open in SportyBet</a>
                <CopyButton text={c.code} />
                {(t || !err) && !foreign && <ShareButton code={c.code} />}
                {last && !foreign && <button type="button" onClick={() => setHedge({ code: c.code, odds: t!.odds,
                  leg: { eventId: last.eventId, market: last.market, kickoff: last.kickoff, home: last.home, away: last.away, label: last.label } })}>Hedge</button>}
                {t && !settled && !foreign && endpoint && (
                  <details className="alertmenu">
                    <summary aria-label={`Alerts for ${c.code}: ${ALERT_MODES.find(([v]) => v === (mode ?? "default"))![1]}`}
                      className={mode === "goals" ? "on" : mode === "off" ? "off" : "key"}>
                      <Icon d={mode === "off" ? BELL_OFF : BELL} />
                      <span className="alertlabel" aria-hidden="true">{mode === "goals" ? "Goals" : mode === "off" ? "Off" : "Key"}</span>
                    </summary>
                    <div className="alertpop" role="radiogroup" aria-label={`Alerts for ${c.code}`}>
                      {ALERT_MODES.map(([v, label, hint]) => (
                        <button key={v} type="button" role="radio" aria-checked={(mode ?? "default") === v}
                          onClick={(e) => { chooseMode(c.code, v, t.lastKickoff); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>
                          <strong>{label}</strong><small>{hint}</small>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
                {tab === "history" && <button type="button" className="danger-ghost" onClick={() => remove(c)} aria-label={`Remove ${c.code}`}>Remove</button>}
              </div>
              {t && !settled && !foreign && endpoint === null && isOpen && (
                <p className="hint"><a href="/alerts">Turn on notifications</a> to follow this code or its matches without opening the app.</p>
              )}
              {legs.length > 0 && !foreign && (
                <button type="button" className="legsrow" aria-expanded={isOpen} onClick={() => toggle(c.code)}>
                  {isOpen ? "Hide legs ▴" : `Show ${legs.length} legs ▾`}
                </button>
              )}
              {isOpen && legs.length > 0 && (
                <ol className="legs">
                  {legs.map((l) => {
                    const st = eff(l), x = live[legKey(l)];
                    const playing = x?.state === "playing" && x.score;
                    const lc = x?.chance ?? null;
                    const course = st === "won" ? "won" : st === "lost" ? "lost" : playing && lc !== null ? (lc >= 0.5 ? "on" : "off") : "";
                    const followed = follows.has(l.eventId);
                    return (
                    <li key={l.eventId} className={`leg-${st} ${course ? `course-${course}` : ""}`}>
                      <span className="legicon" aria-hidden="true">{ICON[st]}</span>
                      <span className="legmain">{l.home} v {l.away}
                        <small>{l.label}{view === "detailed" ? <> · {l.odds ? <>prematch <strong className="num">{l.odds.toFixed(2)}</strong></> : "prematch odds not seen"}</> : l.odds ? <> · <span className="num">{l.odds.toFixed(2)}</span></> : null} · {lagos(l.kickoff)}</small>
                        {lc !== null && (st === "playing" || st === "waiting") && (
                          <span className="legmeter" aria-hidden="true"><span style={{ width: `${Math.round(lc * 100)}%` }} /></span>
                        )}
                      </span>
                      <span className="legres">
                        {playing && <span className={`livepill ${x!.phase === "HT" ? "ht" : ""}`}>{x!.phase === "HT" ? "HT" : x!.minute !== null ? `${x!.minute}'` : "Live"}</span>}
                        <b className={`score num ${goalFlash.has(l.eventId) ? "goal" : ""}`}>
                          {l.status === "won" || l.status === "lost" ? `${l.score}${l.market.startsWith("FH_") && l.ht ? ` (HT ${l.ht})` : ""}`
                            : playing ? x!.score : l.kickoff > now ? lagos(l.kickoff)
                            : <span className="legwait"><i className="spin" aria-hidden="true" />{x?.state === "ended" ? "Settling" : <span className="sr-only">Checking</span>}</span>}
                        </b>
                        {lc !== null && (st === "playing" || st === "waiting") && <small className="legchance">{pctText(lc)}%</small>}
                        <span className="sr-only"> {st}</span>
                      </span>
                      {endpoint && !settled && (st === "waiting" || st === "playing") && (
                        <button type="button" className={`followbtn ${followed ? "on" : ""}`} aria-pressed={followed}
                          aria-label={`${followed ? "Stop following" : "Follow"} ${l.home} v ${l.away}`}
                          title={followed ? "Following: kick-off, goals, half and full time" : "Follow this match"}
                          onClick={() => toggleFollow(l)}><Icon d={followed ? BELL : BELL} /></button>
                      )}
                    </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      <p className={`savedtoast ${note ? "on" : ""}`} role="status" aria-live="polite">{note}</p>
      {hedge && <HedgeSheet code={hedge.code} leg={hedge.leg} odds={hedge.odds} stake={stake} onClose={closeHedge} />}
      {more > 0 && <button type="button" className="moreb" onClick={() => setPages((p) => p + 1)}>Show {Math.min(more, PAGE)} more</button>}
    </section>
  );
}
