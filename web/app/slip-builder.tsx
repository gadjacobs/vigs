"use client";
import { useMemo, useState, useTransition } from "react";
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
import { atLeast } from "@/lib/flex";
import { chance, CONFIDENCE_WHY, oneIn, slipConfidence } from "@/lib/plain";
import type { Query } from "@/lib/query";
import { slipStats, smartSwitch, toTarget, topN } from "@/lib/slip";

const LOW_CHANCE = 0.2;

type Props = { cands: Pick[]; q: Query; now: number; initialView: View; initialIds?: string[]; title?: string; flex?: boolean; stake?: number };

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
            {v === "simple" ? "Chance" : "Full numbers"}
          </button>
        ))}
      </div>
    </div>
  );
}

function FlexTable({ legs }: { legs: Pick[] }) {
  const ps = legs.map((p) => p.estimate);
  const n = legs.length;
  const rows = [0, 1, 2].filter((m) => n - m >= 1);
  return (
    <table className="flextable">
      <caption>With Flex on in SportyBet, the slip still pays a reduced amount when legs miss.</caption>
      <thead><tr><th>Legs that must land</th><th className="n">Chance</th></tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m}><td>{m === 0 ? `All ${n}` : `At least ${n - m} of ${n}`}</td><td className="n">{pct(atLeast(ps, n - m))}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function SlipBuilder({ cands, q, now, initialView, initialIds, title = "Your slip", flex = false, stake = 1000 }: Props) {
  const [view, setView] = useState<View>(initialView);
  const { mode, count, target, sort } = q;
  const initial = useMemo(
    () => initialIds ?? (mode === "target" ? toTarget(cands, target, q.tol, q.maxLegs || 30) : topN(cands, count, sort)).map((p) => p.id),
    [cands, mode, count, target, sort, q.tol, q.maxLegs, initialIds],
  );
  const [watching, setWatching] = useState(false);
  const [ids, setIds] = useState<string[]>(initial);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<BookResult | null>(null);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(cands.map((p) => [p.id, p])), [cands]);
  const legs = ids.map((id) => byId.get(id)).filter((p): p is Pick => !!p);
  const s = slipStats(legs);
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
                Total odds <strong className="num">{s.odds.toFixed(2)}</strong> need {pct(1 / s.odds)} to break even.</span>
            </p>
            <p className="why">
              <span className={`badge conf-${conf.toLowerCase()}`}>{conf} confidence</span>{" "}
              {conf === "High" ? "Every leg: " : "At least one leg: "}{CONFIDENCE_WHY[conf]}. Bookmaker {pct(s.market)}, edge {naira(s.edge)} per ₦1,000.
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
          <p className="returns">₦{stake.toLocaleString("en-NG")} returns <strong className="num">₦{Math.round(stake * s.odds).toLocaleString("en-NG")}</strong> if every leg lands.</p>
        )}
        {flex && legs.length > 1 && <FlexTable legs={legs} />}
        {legs.length > 1 && s.model < LOW_CHANCE && (
          <p className="note warn">As one accumulator this lands {pct(s.model)} of the time on Vig's estimate. Most slips like this lose; singles keep each leg's own odds.</p>
        )}
        <div className="row">
          <button className={result?.ok ? "" : "primary"} type="button" disabled={!legs.length || pending} onClick={book}>
            {pending ? "Booking…" : `Get booking code (${legs.length})`}
          </button>
          {result?.ok && (
            <a className="button primary" href={shareUrl(result.code)}>Open in SportyBet</a>
          )}
          <button type="button" onClick={() => edit(initial, "Slip reset.")} disabled={pending}>Reset</button>
        </div>
        <p className="status" role="status" aria-live="polite">{msg}</p>
      </div>
      )}

      {legs.length > 0 && !result?.ok && (
        <div className="dock" role="region" aria-label="Slip summary">
          <span><strong className="num">{s.odds.toFixed(2)}</strong> odds, {legs.length} legs, {view === "simple" ? `${chance(s.model)} chance` : pct(s.model)}</span>
          <button className="primary" type="button" disabled={pending} onClick={book} aria-label={`Get booking code for ${legs.length} legs`}>{pending ? "Booking…" : "Book"}</button>
        </div>
      )}

      {result && (result.ok ? (
        <section className="receipt" aria-live="polite" aria-labelledby="code-title">
          <h2 id="code-title" style={{ margin: 0, fontSize: 18 }}>Booking code ready</h2>
          <p className="code">{result.code}</p>
          <p className="status">
            {result.legs} selections. {result.verified === result.legs ? "Checked: the code loads exactly these legs." : `Only ${result.verified} of ${result.legs} loaded back; check the slip in SportyBet.`}
            {result.started ? ` ${result.started} leg${result.started > 1 ? "s have" : " has"} already kicked off: the code includes ${result.started > 1 ? "them" : "it"}, but SportyBet may not take bets on ${result.started > 1 ? "them" : "it"} any more.` : ""}
            {` Last match kicks off at ${lagos(result.lastKickoff)} Lagos; each match drops off once it starts.`}
          </p>
          <div className="row">
            <CopyButton text={result.code} />
            <ShareButton code={result.code} />
          </div>
          <p className="status" style={{ marginTop: 8 }}>Opens the SportyBet app if it is installed, otherwise the website. Vig never places the bet.</p>
          <p className="status">
            {watching ? <>You will get a notification when this code lands or loses. <a href="/codes">Follow it in Codes</a>.</> : <><a href="/codes">Follow it in Codes</a>. <a href="/alerts">Turn on notifications</a> to hear when it settles.</>}
          </p>
        </section>
      ) : <p className="note warn" role="alert">{result.error}</p>)}

      <ol className="picks">
        {legs.map((p) => (
          <PickRow key={p.id} p={p} now={now} view={view} actions={<>
            <button type="button" onClick={() => swap(p)}>Smart switch</button>
            <button type="button" onClick={() => remove(p)}>Remove</button>
          </>} />
        ))}
      </ol>

      {rest.length > 0 && (
        <details className="more" open={!legs.length}>
          <summary>Add from {cands.length - legs.length} other selections</summary>
          <ol className="picks">
            {rest.map((p) => <PickRow key={p.id} p={p} now={now} view={view} actions={<button type="button" onClick={() => add(p)}>Add to slip</button>} />)}
          </ol>
        </details>
      )}
    </section>
  );
}
