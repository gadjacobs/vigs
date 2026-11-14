"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { bookSlip } from "../actions";
import { liveCodes, trackCodes } from "../codes-api";
import { rememberCode } from "../codes-panel";
import { CopyButton } from "../copy-button";
import { OpenInSportyBet } from "../open-sporty";
import { lagos } from "../pick-row";
import { syncRollovers } from "../profile-actions";
import { nextStep, type StepOffer } from "../rollover-actions";
import { Teams } from "../teams";
import type { LiveLeg } from "@/lib/live";
import { naira } from "@/lib/money";
import { chance as pctText, oneIn } from "@/lib/plain";
import {
  addStep, again, bank, BANDS, milestones, newRollover, openStep, PER_STEP, plan, progress, settleStep, stepChance, stepOdds,
  type RLeg, type Rollover,
} from "@/lib/rollover";

const KEY = "vig_rollovers";
const read = (): Rollover[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Rollover[]; } catch { return []; } };
const write = (list: Rollover[]) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch { /* full or private */ } };
const legKey = (l: { eventId: string; market: string }) => `${l.eventId}|${l.market}`;
const short = (x: number) => x >= 1e6 ? `₦${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1).replace(/\.0$/, "")}m` : x >= 1e3 ? `₦${Math.round(x / 1e3)}k` : naira(x);
const hours = (h: number) => h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;

const STARTS = [1000, 5000, 10000, 50000];
const GOALS = [10, 100, 1000];

export function RolloverPanel({ defaultStake }: { defaultStake: number }) {
  const [list, setList] = useState<Rollover[]>([]);
  const [ready, setReady] = useState(false);
  // Load from this device at once, then merge the account's (other devices).
  useEffect(() => {
    const local = read();
    setList(local);
    setReady(true);
    syncRollovers(local).then((m) => { if (m) { write(m); setList(m); } }).catch(() => undefined);
  }, []);
  const save = useCallback((r: Rollover) => {
    setList((cur) => {
      const next = [r, ...cur.filter((x) => x.id !== r.id)].sort((a, b) => b.created - a.created);
      write(next);
      syncRollovers([r]).catch(() => undefined);
      return next;
    });
  }, []);
  const active = list.find((r) => r.status === "running") ?? null;
  const last = list[0] ?? null;
  const [setup, setSetup] = useState(false);
  // The finished run shown in full (the latest, when nothing is running); the rest are listed below.
  const shown = !active && !setup && last && last.status !== "running" ? last : null;

  if (!ready) return <div className="ro-skel" aria-busy="true"><span className="skel skel-panel" /><span className="skel skel-card" /></div>;
  return (
    <>
      {active && !setup ? <Run r={active} save={save} onNew={() => setSetup(true)} />
        : !setup && last && last.status !== "running" ? <Ended r={last} save={save} onNew={() => setSetup(true)} />
        : <Setup defaultStake={defaultStake} from={last} onCancel={active || last ? () => setSetup(false) : undefined}
            onStart={(r) => { if (active) save({ ...active, status: "banked", ended: Date.now(), updated: Date.now() }); save(r); setSetup(false); }} />}
      <Past list={list.filter((r) => r.status !== "running" && r.id !== shown?.id)} />
    </>
  );
}

/** Start a run: stake, goal, price per step and legs per step, with the honest plan beside it. */
function Setup({ defaultStake, from, onStart, onCancel }: { defaultStake: number; from: Rollover | null; onStart: (r: Rollover) => void; onCancel?: () => void }) {
  const [start, setStart] = useState(from?.start ?? (STARTS.includes(defaultStake) ? defaultStake : 5000));
  const [goal, setGoal] = useState(from ? Math.round(from.target / from.start) : 1000);
  const [band, setBand] = useState(BANDS.find((b) => b.lo === from?.lo && b.hi === from?.hi)?.id ?? "balanced");
  const [perStep, setPerStep] = useState(from?.perStep ?? 1);
  const b = BANDS.find((x) => x.id === band)!;
  const p = plan(start, start * goal, b.lo, b.hi, perStep);
  return (
    <section className="ro-setup" aria-labelledby="ro-setup-title">
      <h2 id="ro-setup-title">Start a rollover</h2>
      <p className="ro-lede">One short-priced step each round. When it lands, the whole pot rolls into the next. Stop and keep the pot whenever you like.</p>
      <div className="ro-field"><span>Start with</span>
        <div className="presets" role="radiogroup" aria-label="Start with">
          {STARTS.map((s) => <button key={s} type="button" role="radio" aria-checked={start === s} onClick={() => setStart(s)}>{short(s)}</button>)}
          <input type="text" inputMode="numeric" aria-label="Other amount" className="ro-amount" value={STARTS.includes(start) ? "" : String(start)}
            placeholder="Other" onChange={(e) => { const n = Math.round(Number(e.target.value.replace(/[^\d]/g, ""))); if (n > 0) setStart(n); }} />
        </div>
      </div>
      <div className="ro-field"><span>Aim for</span>
        <div className="presets" role="radiogroup" aria-label="Aim for">
          {GOALS.map((g) => <button key={g} type="button" role="radio" aria-checked={goal === g} onClick={() => setGoal(g)}>×{g.toLocaleString("en-NG")} · {short(start * g)}</button>)}
        </div>
      </div>
      <div className="ro-field"><span>Price per leg</span>
        <div className="ro-bands" role="radiogroup" aria-label="Price per leg">
          {BANDS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={band === x.id} onClick={() => setBand(x.id)}>
              <b>{x.label}</b><span className="num">{x.lo.toFixed(2)}–{x.hi.toFixed(2)}</span><small>{x.hint}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="ro-field"><span>Legs per step</span>
        <div className="seg2" role="radiogroup" aria-label="Legs per step">
          {PER_STEP.map((k) => <button key={k} type="button" role="radio" aria-checked={perStep === k} onClick={() => setPerStep(k)}>{k === 1 ? "Single" : `${k} legs`}</button>)}
        </div>
      </div>
      <div className="ro-plan" aria-live="polite">
        <div><b className="num">{p.steps}</b><small>steps</small></div>
        <div><b className="num">~{hours(p.hours)}</b><small>of rounds</small></div>
        <div><b className="num">{pctText(p.perStepChance)}</b><small>each step lands</small></div>
        <p>Reaching {short(start * goal)} from {short(start)} takes every one of those steps landing: <strong>{oneIn(p.chance)}</strong>.
          {" "}Each step gives SportyBet its cut, so a run is most likely to end on a lost step. Bank the pot whenever it&apos;s a sum you&apos;d be glad to keep.</p>
      </div>
      <div className="sheet-actions">
        <button type="button" className="button primary" onClick={() => onStart(newRollover({ start, target: start * goal, lo: b.lo, hi: b.hi, perStep }))}>Start · {short(start)} → {short(start * goal)}</button>
        {onCancel && <button type="button" className="linkish" onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  );
}

/** A run in progress: the climb, the step to book (or the one playing), and the ladder so far. */
function Run({ r, save, onNew }: { r: Rollover; save: (r: Rollover) => void; onNew: () => void }) {
  const open = openStep(r);
  const p = plan(r.pot, r.target, r.lo, r.hi, r.perStep);
  const ms = milestones(r.start, r.target);
  const done = r.steps.filter((s) => s.state === "won").length;
  const status = open ? `Step ${open.n} ${open.legs.some((l) => l.kickoff <= Date.now()) ? "playing" : "booked"}`
    : done ? `${done} step${done > 1 ? "s" : ""} landed` : "Ready for step 1";
  return (
    <section className="ro-run" aria-label="Rollover in progress">
      <div className="ro-hero">
        <div className="ro-pot">
          <small>Pot now</small>
          <b className="num">{naira(r.pot)}</b>
          <span>{status} · started {short(r.start)} · aim {short(r.target)}</span>
        </div>
        <Climb r={r} ms={ms} />
        <p className="ro-odds">From here: about {p.steps} more step{p.steps === 1 ? "" : "s"}, ~{hours(p.hours)}, reaching {short(r.target)} <strong>{oneIn(p.chance)}</strong>.</p>
      </div>
      {open ? <OpenStep r={r} s={open} save={save} /> : <Offer r={r} save={save} />}
      <div className="ro-tools">
        {!open && r.steps.length > 0 && <button type="button" className="button" onClick={() => save(bank(r))}>Bank {short(r.pot)} and stop</button>}
        <button type="button" className="linkish" onClick={onNew}>New rollover</button>
      </div>
      {r.steps.length > 0 && <Ladder r={r} />}
    </section>
  );
}

/** The pot's climb on a log scale, with ×10 milestones and the target flag. */
function Climb({ r, ms }: { r: Rollover; ms: number[] }) {
  const at = progress(r.start, r.pot, r.target), best = progress(r.start, r.best, r.target);
  return (
    <div className="ro-climb" role="img" aria-label={`${Math.round(at * 100)}% of the way to ${naira(r.target)}`}>
      <span className="ro-track"><i className="ro-best" style={{ width: `${best * 100}%` }} /><i className="ro-fill" style={{ width: `${at * 100}%` }} /></span>
      {ms.map((m) => <span key={m} className={`ro-ms ${r.best >= m ? "hit" : ""}`} style={{ left: `${progress(r.start, m, r.target) * 100}%` }}><em>{short(m)}</em></span>)}
      <span className="ro-flag" aria-hidden="true">⚑<em>{short(r.target)}</em></span>
      <span className="ro-dot" style={{ left: `${at * 100}%` }} aria-hidden="true" />
    </div>
  );
}

/** The next step Vig suggests: the likeliest legs in the price range, in the soonest round. */
function Offer({ r, save }: { r: Rollover; save: (r: Rollover) => void }) {
  const [skip, setSkip] = useState(0);
  const [offer, setOffer] = useState<StepOffer | null>(null);
  const [legs, setLegs] = useState<RLeg[]>([]);
  const [alts, setAlts] = useState<RLeg[]>([]);
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const load = useCallback(() => {
    setOffer(null);
    nextStep({ lo: r.lo, hi: r.hi, perStep: r.perStep, skip }).then((o) => {
      setOffer(o);
      if ("legs" in o) { setLegs(o.legs); setAlts(o.alts); }
    }).catch(() => setOffer({ error: "Couldn't reach Vig. Check your connection." }));
  }, [r.lo, r.hi, r.perStep, skip]);
  useEffect(() => { load(); }, [load]);
  // A round that has kicked off is gone: fetch the next.
  useEffect(() => { if (offer && "kickoff" in offer && offer.kickoff <= now + 60_000) load(); }, [offer, now, load]);

  if (!offer) return <div className="ro-step loading" aria-busy="true"><span className="skel skel-line" /><span className="skel skel-card" /></div>;
  if ("error" in offer) return <div className="ro-step"><p className="note">{offer.error}</p><button type="button" className="button" onClick={load}>Try again</button></div>;
  const odds = stepOdds(legs.map((l) => l.odds)), ch = stepChance(legs.map((l) => l.chance));
  const swap = (i: number) => {
    const nxt = alts[0];
    if (!nxt) return;
    setLegs(legs.map((l, j) => (j === i ? nxt : l)));
    setAlts([...alts.slice(1), legs[i]]);
  };
  const book = () => start(async () => {
    setErr("");
    const res = await bookSlip(legs.map((l) => ({ eventId: l.eventId, market: l.market, kickoff: l.kickoff, odds: l.odds, marketChance: l.chance, home: l.home, away: l.away, league: l.league })), "rollover");
    if (!res.ok) { setErr(res.error); return; }
    rememberCode({ code: res.code, at: Date.now(), legs: legs.length, odds, last: res.lastKickoff });
    save(addStep(r, { code: res.code, legs }));
  });
  const mins = Math.max(0, Math.round((offer.kickoff - now) / 60000));
  return (
    <div className="ro-step">
      <div className="ro-step-head">
        <h3>Step {r.steps.length + 1}</h3>
        <span className="ro-when">Kicks off <b className="num">{lagos(offer.kickoff)}</b> · in {mins} min</span>
      </div>
      <ul className="ro-legs">
        {legs.map((l, i) => (
          <li key={legKey(l)}>
            <span className="ro-leg-main"><Teams league={l.league} home={l.home} away={l.away} /><small>{l.label} · {l.league}</small></span>
            <span className="ro-leg-num"><b className="num">{l.odds.toFixed(2)}</b><small>{pctText(l.chance)}</small></span>
            {alts.length > 0 && <button type="button" className="iconbtn" aria-label={`Swap ${l.home} v ${l.away} for the next likeliest`} onClick={() => swap(i)}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
            </button>}
          </li>
        ))}
      </ul>
      <div className="ro-stake">
        <span><small>Stake the pot</small><b className="num">{naira(r.pot)}</b></span>
        <span aria-hidden="true">→</span>
        <span><small>If it lands ({pctText(ch)})</small><b className="num">{naira(r.pot * odds)}</b></span>
      </div>
      {err && <p className="note warn" role="alert">{err}</p>}
      <button type="button" className="button primary ro-book" disabled={busy} onClick={book}>{busy ? "Booking…" : `Get code for step ${r.steps.length + 1}`}</button>
      <div className="ro-step-tools">
        {offer.rounds.length > 1 && <button type="button" className="linkish" onClick={() => setSkip((s) => (s + 1) % offer.rounds.length)}>Skip to the {skip + 1 < offer.rounds.length ? lagos(offer.rounds[skip + 1]) : lagos(offer.rounds[0])} round</button>}
        <button type="button" className="linkish" onClick={load}>Refresh</button>
      </div>
    </div>
  );
}

/** The booked step: its code, then its legs as they play, until it's decided. */
function OpenStep({ r, s, save }: { r: Rollover; s: NonNullable<ReturnType<typeof openStep>>; save: (r: Rollover) => void }) {
  const [live, setLive] = useState<Record<string, LiveLeg>>({});
  const [now, setNow] = useState(() => Date.now());
  const [unplaced, setUnplaced] = useState(false);
  const checking = useRef(false);
  const started = s.legs.some((l) => l.kickoff <= now);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      setNow(Date.now());
      if (document.visibilityState !== "visible" || checking.current) return;
      if (!s.legs.some((l) => l.kickoff <= Date.now() + 30_000)) return;
      checking.current = true;
      try {
        const [lv, [t]] = await Promise.all([
          liveCodes(s.legs.map((l) => ({ eventId: l.eventId, market: l.market, kickoff: l.kickoff }))).catch(() => ({})),
          trackCodes([s.code]).catch(() => [null]),
        ]);
        if (stop) return;
        setLive(lv as Record<string, LiveLeg>);
        if (t && "legs" in t) {
          if (t.state === "won") save(settleStep(r, "won"));
          else if (t.state === "lost") save(settleStep(r, "lost"));
        }
      } finally { checking.current = false; }
    };
    tick();
    const id = setInterval(tick, 15_000);
    addEventListener("vig-resume", tick);
    return () => { stop = true; clearInterval(id); removeEventListener("vig-resume", tick); };
  }, [r, s, save]);
  const ch = s.legs.reduce((a, l) => a * (live[legKey(l)]?.chance ?? l.chance), 1);
  const mins = Math.round((Math.min(...s.legs.map((l) => l.kickoff)) - now) / 60000);
  return (
    <div className="ro-step open">
      <div className="ro-step-head">
        <h3>Step {s.n}</h3>
        <span className={`ro-when ${started ? "live" : ""}`}>{started ? <><i className="livedot" aria-hidden="true" /> Playing</> : <>Kicks off in {Math.max(0, mins)} min</>}</span>
      </div>
      <div className="ro-code">
        <b className="num">{s.code}</b>
        <OpenInSportyBet code={s.code} />
        <CopyButton text={s.code} icon />
      </div>
      <p className="ro-hint">Place it in SportyBet with the whole pot, <b className="num">{naira(s.stake)}</b>. Vig follows it here and in Codes.</p>
      <ul className="ro-legs">
        {s.legs.map((l) => {
          const x = live[legKey(l)];
          return (
            <li key={legKey(l)} className={x?.chance === 1 ? "won" : x?.chance === 0 ? "lost" : ""}>
              <span className="ro-leg-main"><Teams league={l.league} home={l.home} away={l.away} /><small>{l.label} · {lagos(l.kickoff)}</small></span>
              <span className="ro-leg-num">
                {x?.score ? <b className="num">{x.score.replace(":", "–")}</b> : <b className="num">{l.odds.toFixed(2)}</b>}
                <small>{x?.state === "playing" ? `${x.phase === "HT" ? "HT" : x.minute !== null ? `${x.minute}'` : "live"} · ${pctText(x.chance ?? l.chance)}` : pctText(l.chance)}</small>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ro-stake">
        <span><small>Staked</small><b className="num">{naira(s.stake)}</b></span>
        <span aria-hidden="true">→</span>
        <span><small>Lands {pctText(ch)}</small><b className="num">{naira(s.stake * s.odds)}</b></span>
      </div>
      {!started && (unplaced
        ? <div className="ro-step-tools"><span>Not placed? The pot stays as it was.</span><button type="button" className="danger-ghost" onClick={() => save(settleStep(r, "void"))}>Cancel this step</button></div>
        : <div className="ro-step-tools"><button type="button" className="linkish" onClick={() => setUnplaced(true)}>Didn&apos;t place it?</button></div>)}
    </div>
  );
}

/** Every step so far, newest first: how it went and the pot after. */
function Ladder({ r }: { r: Rollover }) {
  return (
    <ol className="ro-ladder" aria-label="Steps so far">
      {[...r.steps].reverse().map((s) => (
        <li key={s.n} className={`st-${s.state}`}>
          <span className="ro-rung" aria-hidden="true">{s.state === "won" ? "✓" : s.state === "lost" ? "✗" : s.state === "void" ? "–" : s.n}</span>
          <span className="ro-rung-main">
            <span className="ro-rung-head"><b>Step {s.n}</b><span className="num">{s.odds.toFixed(2)}</span></span>
            <small>{s.legs.map((l) => `${l.home} v ${l.away}, ${l.label.toLowerCase()}`).join(" · ")}</small>
          </span>
          <span className="ro-rung-pot num">{s.state === "won" ? naira(s.back ?? 0) : s.state === "lost" ? "₦0" : s.state === "void" ? "not placed" : "playing"}</span>
        </li>
      ))}
    </ol>
  );
}

/** A finished run: how far it went, and one tap to go again. */
function Ended({ r, save, onNew }: { r: Rollover; save: (r: Rollover) => void; onNew: () => void }) {
  const landed = r.steps.filter((s) => s.state === "won").length;
  const head = r.status === "reached" ? `Reached ${short(r.target)}` : r.status === "banked" ? `Banked ${naira(r.pot)}` : `Ended at step ${r.steps.length}`;
  return (
    <section className={`ro-ended is-${r.status}`} aria-label="Last rollover">
      <small>Last rollover</small>
      <h2>{head}</h2>
      <p>{landed} step{landed === 1 ? "" : "s"} landed from {short(r.start)}{r.best > r.start ? `; the pot peaked at ${naira(r.best)}` : ""}.
        {r.status === "lost" && r.best > r.start ? " Banking at a milestone keeps a run like this." : ""}</p>
      <Climb r={{ ...r, pot: r.status === "lost" ? r.start : r.pot }} ms={milestones(r.start, r.target)} />
      <div className="sheet-actions">
        <button type="button" className="button primary" onClick={() => save(again(r))}>Go again · {short(r.start)} → {short(r.target)}</button>
        <button type="button" className="linkish" onClick={onNew}>Change settings</button>
      </div>
      {r.steps.length > 0 && <Ladder r={r} />}
    </section>
  );
}

function Past({ list }: { list: Rollover[] }) {
  if (!list.length) return null;
  return (
    <details className="ro-past">
      <summary>Earlier rollovers <span className="count">{list.length}</span></summary>
      <ul>
        {list.map((r) => (
          <li key={r.id}>
            <span>{lagos(r.created)} · {short(r.start)} → {short(r.target)}</span>
            <b className={r.status === "lost" ? "loss" : ""}>{r.status === "reached" ? "Reached" : r.status === "banked" ? `Banked ${short(r.pot)}` : r.status === "lost" ? `Lost at step ${r.steps.length}` : "Stopped"}</b>
          </li>
        ))}
      </ul>
    </details>
  );
}
