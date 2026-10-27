"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { bookSlip, type BookResult } from "./actions";
import { rememberCode } from "./codes-panel";
import { shareUrl } from "@/lib/share";
import { saveView } from "./profile-actions";
import { watchBooking } from "./push-actions";
import { CopyButton } from "./copy-button";
import { ShareButton } from "./share-sheet";
import { lagos, naira, pct, PickRow, type View } from "./pick-row";
import { MARKET_LABELS } from "@/lib/markets";
import type { Pick } from "@/lib/picks";
import type { LeanRow } from "@/lib/insights";
import { FlexRow } from "./flex-row";
import { KeepMeter } from "./keep-meter";
import { atLeast, flexFriendly } from "@/lib/flex";
import { multiBonus } from "@/lib/bonus";
import { chance, CONFIDENCE_WHY, oneIn, slipConfidence } from "@/lib/plain";
import type { Query } from "@/lib/query";
import { cheaperSwap, slipStats, smartSwitch, toTarget, topN, MAX_LEGS } from "@/lib/slip";

const LOW_CHANCE = 0.2;



type Props = { cands: Pick[]; q: Query; now: number; initialView: View; initialIds?: string[]; title?: string; flex?: boolean; stake?: number; lean?: LeanRow[] };

/** This device's push subscription, if notifications are on. */
async function pushEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  const choose = (v: View) => {
    setView(v);
    document.cookie = `vig_view=${v}; path=/; max-age=31536000; samesite=lax`;
    saveView(v).catch(() => undefined);
  };
  return (
    <div className="viewbar">
      <span className="muted">Show</span>
      <div className="segmented" role="radiogroup" aria-label="How picks are shown">
        {(["simple", "detailed"] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => choose(v)}>
            {v === "simple" ? "Simple" : "Rich"}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SlipBuilder({ cands, q, now, initialView, initialIds, title = "Your slip", stake = 1000, lean }: Props) {
  const [view, setView] = useState<View>(initialView);
  const { mode, count, target, sort } = q;
  const initial = useMemo(
    () => initialIds ?? (mode === "target" ? toTarget(cands, target, q.tol, q.maxLegs || MAX_LEGS) : topN(cands, count, sort)).map((p) => p.id),
    [cands, mode, count, target, sort, q.tol, q.maxLegs, initialIds],
  );
  const [watching, setWatching] = useState(false);
  const [ids, setIds] = useState<string[]>(initial);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<BookResult | null>(null);
  const [pending, start] = useTransition();
  // The summary bar above the tab bar shows only while the slip's own Book button is off screen.
  const bookRef = useRef<HTMLDivElement>(null);
  const [bookSeen, setBookSeen] = useState(true);
  const hasLegs = ids.length > 0, booked = Boolean(result?.ok);
  // A new code: bring it into view (booking from the bar at the bottom leaves it off screen).
  const bookedCode = result?.ok ? result.code : null;
  useEffect(() => {
    if (!bookedCode) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => bookRef.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" }));
  }, [bookedCode]);
  useEffect(() => {
    const el = bookRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setBookSeen(e.isIntersecting), { rootMargin: "0px 0px -72px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasLegs, booked]);
  const byId = useMemo(() => new Map(cands.map((p) => [p.id, p])), [cands]);
  const legs = ids.map((id) => byId.get(id)).filter((p): p is Pick => !!p);
  const s = slipStats(legs);
  const costliest = legs.length ? legs.reduce((a, p) => (p.odds * p.marketChance < a.odds * a.marketChance ? p : a)).id : null;
  const conf = slipConfidence(legs);
  const onSlip = new Set(legs.map((p) => p.eventId));
  const rest = [...cands]
    .filter((p) => !onSlip.has(p.eventId))
    .sort((a, b) => (sort === "edge" ? b.edge - a.edge : b.estimate - a.estimate))
    .slice(0, 12);

  const edit = (next: string[], note: string) => {
    setIds(next);
    setMsg(note);
    setResult(null);
  };
  const remove = (p: Pick) => edit(ids.filter((i) => i !== p.id), `Removed ${p.home} v ${p.away}.`);
  const swap = (p: Pick) => {
    const alt = smartSwitch(legs, cands, p.id);
    if (!alt) return setMsg("No other selection fits. Remove the leg instead, or widen the filters.");
    edit(ids.map((i) => (i === p.id ? alt.id : i)),
      `Switched ${p.home} v ${p.away} (${p.odds.toFixed(2)}) for ${alt.home} v ${alt.away}, ${MARKET_LABELS[alt.market]} (${alt.odds.toFixed(2)}).`);
  };
  const add = (p: Pick) => edit([...ids, p.id], `Added ${p.home} v ${p.away}.`);

  const book = () => start(async () => {
    const res = await bookSlip(legs.map((p) => ({
      eventId: p.eventId, market: p.market, kickoff: p.kickoff, odds: p.odds, estimate: p.estimate,
      marketChance: p.marketChance, lo: p.lo, hi: p.hi, home: p.home, away: p.away, league: p.league,
    })), title === "Your slip" ? "tonight" : `ourpicks:${title}`);
    setResult(res);
    if (res.ok) {
      rememberCode({ code: res.code, at: Date.now(), legs: res.legs, odds: s.odds, last: res.lastKickoff });
      navigator.vibrate?.(18);
      const endpoint = await pushEndpoint();
      setWatching(Boolean(endpoint && (await watchBooking(res.code, endpoint, res.lastKickoff))));
    }
  });

  if (!cands.length) return null;
  return (
    <section aria-labelledby="slip-title">
      <ViewToggle view={view} setView={setView} />
      {!legs.length ? (
        <p className="note" role="status">
          {mode === "target"
            ? `Nothing in this window reaches total odds of ${target} (±${Math.round(q.tol * 100)}%)${q.maxLegs ? ` in ${q.maxLegs} games or fewer` : ""}. Widen the tolerance or window, add markets, or build from the selections below.`
            : "Your slip is empty. Add selections from the list below."}
        </p>
      ) : (
      <div className="panel slipbar">
        <h2 id="slip-title" className="sliptitle">{title}</h2>
        {view === "simple" ? (
          <div className="slipplain">
            <p className="plain">
              <strong className="num chance">{chance(s.model)}</strong>
              <span>chance all {legs.length} {legs.length === 1 ? "leg lands" : "legs land"}, {oneIn(s.model)}.
                Total odds <strong className="num">{s.odds.toFixed(2)}</strong>.</span>
            </p>
            <p className="why">
              <span className={`badge conf-${conf.toLowerCase()}`}>{conf} confidence</span>
            </p>
          </div>
        ) : (
        <dl className="stats slipstats">
          <div><dt>Legs</dt><dd>{legs.length}</dd></div>
          <div><dt>Combined odds</dt><dd className="num bigodds">{legs.length ? s.odds.toFixed(2) : "None"}</dd></div>
          <div><dt>Vig estimate</dt><dd>{legs.length ? pct(s.model) : "None"}</dd></div>
          <div><dt>Market chance</dt><dd className="fair">{legs.length ? pct(s.market) : "None"}</dd></div>
          <div><dt>Edge per ₦1,000</dt><dd>{legs.length ? naira(s.edge) : "None"}</dd></div>
        </dl>
        )}
        {stake > 0 && legs.length > 0 && (
          (() => {
            const b = multiBonus(legs.map((p) => ({ odds: p.odds, p: p.marketChance })));
            const naira0 = (x: number) => `₦${Math.round(x).toLocaleString("en-NG")}`;
            return (
              <p className="returns">{naira0(stake)} returns <strong className="num">{naira0(stake * b.totalOdds)}</strong> if every leg lands
                {b.ratio > 0 ? <>, with SportyBet&apos;s multi-bet bonus of about <strong className="num">+{Math.round(b.ratio * 100)}%</strong> ({naira0(stake * b.extra)} on {b.qualifying} legs at 1.20 or more)</> : null}.
                {b.qualifying < legs.length && legs.length >= 2 ? <> {legs.length - b.qualifying} leg{legs.length - b.qualifying > 1 ? "s" : ""} under 1.20 earn{legs.length - b.qualifying > 1 ? "" : "s"} no bonus.</> : null}
                {view === "detailed" && <>{" "}On average about <strong className="num">{naira0(stake * b.payback)}</strong> comes back, by the bookmaker&apos;s own chances, bonus included.</>}</p>
            );
          })()
        )}
        <KeepMeter legs={legs} />
        {legs.length >= 2 && (() => {
          const sw = cheaperSwap(legs, cands);
          return sw ? (
            <button type="button" className="cheaper" onClick={() => edit(ids.map((i) => (i === sw.out.id ? sw.inn.id : i)),
              `Swapped ${sw.out.home} v ${sw.out.away}, ${MARKET_LABELS[sw.out.market]} (${sw.out.odds.toFixed(2)}) for ${sw.inn.home} v ${sw.inn.away}, ${MARKET_LABELS[sw.inn.market]} (${sw.inn.odds.toFixed(2)}): the slip now keeps about ₦${Math.round(sw.keep * 1000)} of every ₦1,000.`)}>
              <span><strong>Make it cheaper</strong><small>Swap {sw.out.home} v {sw.out.away} ({MARKET_LABELS[sw.out.market] ?? sw.out.market}) for {sw.inn.home} v {sw.inn.away} ({MARKET_LABELS[sw.inn.market] ?? sw.inn.market}), about the same odds</small></span>
              <b className="num">+₦{Math.round((sw.keep - sw.before) * 1000)}</b>
            </button>
          ) : <p className="cheapest">Already the cheapest slip at these odds from the selections here.</p>;
        })()}
        <FlexRow ps={legs.map((p) => p.estimate)} market={legs.map((p) => p.marketChance)} note={`Flex pays a reduced amount when legs miss: SportyBet sets its odds so it returns about ₦0.65 per ₦1 on vFootball, whatever the legs, and pays no multi-bet bonus; this slip straight returns about ₦${multiBonus(legs.map((p) => ({ odds: p.odds, p: p.marketChance }))).payback.toFixed(2)} per ₦1 with the bonus. Set Flex in SportyBet before you place the slip.`} />
        {legs.length >= 5 && (() => {
          // Drop the least likely legs until "all but two" lands at least half the time.
          const keep = flexFriendly(legs.map((p) => p.estimate));
          if (keep.length === legs.length) return null;
          const kept = keep.map((i) => legs[i]);
          const after = atLeast(kept.map((p) => p.estimate), kept.length - 2);
          return (
            <button type="button" className="flexfit" onClick={() => edit(kept.map((p) => p.id),
              `Dropped the ${legs.length - kept.length} least likely legs: ${kept.length - 2} of ${kept.length} now lands ${chance(after)} of the time.`)}>
              Make it Flex-friendly: drop the {legs.length - kept.length} least likely legs
            </button>
          );
        })()}
        {legs.length > 1 && s.model < LOW_CHANCE && (
          <p className="note warn">As one accumulator this lands {pct(s.model)} of the time on Vig's estimate. Most slips like this lose; singles keep each leg's own odds.</p>
        )}
        <div ref={bookRef}>
          {result?.ok ? (
            <div className="booked" aria-live="polite">
              <div className="booked-head">
                <span className="booked-kicker">Booking code</span>
                <strong className="num booked-code">{result.code}</strong>
                <span className="booked-sub">{result.legs} legs · <span className="num">{s.odds.toFixed(2)}</span> odds</span>
              </div>
              <div className="codeactions">
                <a className="button primary" href={shareUrl(result.code)}>Open in SportyBet</a>
                <div className="codetools">
                  <CopyButton text={result.code} label="Copy" />
                  <ShareButton code={result.code} />
                  <a className="button" href="/codes">Codes</a>
                </div>
              </div>
              <p className="booked-note">
                {result.verified === result.legs ? "Checked: the code loads exactly these legs." : `Only ${result.verified} of ${result.legs} loaded back; check the slip in SportyBet.`}
                {result.started ? ` ${result.started} leg${result.started > 1 ? "s have" : " has"} already kicked off: the code includes ${result.started > 1 ? "them" : "it"}, but SportyBet may not take bets on ${result.started > 1 ? "them" : "it"} any more.` : ""}
                {` Last match kicks off at ${lagos(result.lastKickoff)} Lagos. Vig never places the bet.`}
                {watching ? " You'll get a notification when it lands or loses." : <> <a href="/alerts">Turn on notifications</a> to hear when it settles.</>}
              </p>
            </div>
          ) : (
            <div className="bookbar">
              <button className="primary bookbtn" type="button" disabled={!legs.length || pending} onClick={book}>
                {pending ? "Booking…" : <>Get booking code<small><span className="num">{legs.length}</span> legs · <span className="num">{s.odds.toFixed(2)}</span> odds</small></>}
              </button>
              <button type="button" className="linkish" onClick={() => edit(initial, "Slip reset.")} disabled={pending}>Reset slip</button>
            </div>
          )}
        </div>
        <p className="status" role="status" aria-live="polite">{msg}</p>
      </div>
      )}

      {legs.length > 0 && !result?.ok && (
        <div className={`dock ${bookSeen ? "" : "on"}`} role="region" aria-label="Slip summary" inert={bookSeen}>
          <span><strong className="num">{s.odds.toFixed(2)}</strong> odds, {legs.length} legs, {view === "simple" ? `${chance(s.model)} chance` : pct(s.model)}</span>
          <button className="primary" type="button" disabled={pending} onClick={book} aria-label={`Get booking code for ${legs.length} legs`}>{pending ? "Booking…" : "Book"}</button>
        </div>
      )}

      {result && !result.ok && <p className="note warn" role="alert">{result.error}</p>}

      <ol className="picks">
        {legs.map((p) => (
          <PickRow key={p.id} p={p} now={now} view={view} lean={lean} cost worst={legs.length > 1 && p.id === costliest} actions={<>
            <button type="button" onClick={() => swap(p)}>Smart switch</button>
            <button type="button" onClick={() => remove(p)}>Remove</button>
          </>} />
        ))}
      </ol>

      {rest.length > 0 && (
        <details className="more" open={!legs.length}>
          <summary>Add from {cands.length - legs.length} other selections</summary>
          <ol className="picks">
            {rest.map((p) => <PickRow key={p.id} p={p} now={now} view={view} lean={lean} actions={<button type="button" onClick={() => add(p)}>Add to slip</button>} />)}
          </ol>
        </details>
      )}
    </section>
  );
}
