"use client";
import { useMemo, useState, useTransition } from "react";
import { bookSlip, type BookResult } from "./actions";
import { CopyButton } from "./copy-button";
import { lagos, naira, pct, PickRow } from "./pick-row";
import { MARKET_LABELS } from "@/lib/markets";
import type { Pick } from "@/lib/picks";
import { slipStats, smartSwitch, toTarget, topN, type SortKey } from "@/lib/slip";

const LOW_CHANCE = 0.2;
const shareUrl = (code: string) => `https://www.sportybet.com/ng/?shareCode=${code}`;

type Props = { cands: Pick[]; mode: "count" | "target"; count: number; target: number; sort: SortKey };

export function SlipBuilder({ cands, mode, count, target, sort }: Props) {
  const initial = useMemo(
    () => (mode === "target" ? toTarget(cands, target) : topN(cands, count, sort)).map((p) => p.id),
    [cands, mode, count, target, sort],
  );
  const [ids, setIds] = useState<string[]>(initial);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<BookResult | null>(null);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(cands.map((p) => [p.id, p])), [cands]);
  const legs = ids.map((id) => byId.get(id)).filter((p): p is Pick => !!p);
  const s = slipStats(legs);
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

  if (!cands.length) return null;
  return (
    <section aria-labelledby="slip-title">
      <div className="panel slipbar">
        <h2 id="slip-title" className="sliptitle">Your slip</h2>
        <dl className="stats slipstats">
          <div><dt>Legs</dt><dd>{legs.length}</dd></div>
          <div><dt>Combined odds</dt><dd className="num bigodds">{legs.length ? s.odds.toFixed(2) : "None"}</dd></div>
          <div><dt>Vig estimate</dt><dd>{legs.length ? pct(s.model) : "None"}</dd></div>
          <div><dt>Market chance</dt><dd className="fair">{legs.length ? pct(s.market) : "None"}</dd></div>
          <div><dt>Edge per ₦1,000</dt><dd>{legs.length ? naira(s.edge) : "None"}</dd></div>
        </dl>
        {mode === "target" && !legs.length && (
          <p className="note">Nothing in this window reaches odds of {target} with these filters. Widen the window, add markets or relax the odds range.</p>
        )}
        {legs.length > 1 && s.model < LOW_CHANCE && (
          <p className="note warn">As one accumulator this lands {pct(s.model)} of the time on Vig's estimate. Most slips like this lose; singles keep each leg's own odds.</p>
        )}
        <div className="row">
          <button className={result?.ok ? "" : "primary"} type="button" disabled={!legs.length || pending}
            onClick={() => start(async () => setResult(await bookSlip(legs.map((p) => ({ eventId: p.eventId, market: p.market, kickoff: p.kickoff })))))}>
            {pending ? "Booking…" : `Get booking code (${legs.length})`}
          </button>
          {result?.ok && (
            <a className="button primary" href={shareUrl(result.code)}>Open in SportyBet</a>
          )}
          <button type="button" onClick={() => edit(initial, "Slip reset.")} disabled={pending}>Reset</button>
        </div>
        <p className="status" role="status" aria-live="polite">{msg}</p>
      </div>

      {result && (result.ok ? (
        <section className="receipt" aria-live="polite" aria-labelledby="code-title">
          <h2 id="code-title" style={{ margin: 0, fontSize: 18 }}>Booking code ready</h2>
          <p className="code">{result.code}</p>
          <p className="status">
            {result.legs} selections. {result.verified === result.legs ? "Checked: the code loads exactly these legs." : `Only ${result.verified} of ${result.legs} loaded back; check the slip in SportyBet.`}
            {result.skipped ? ` ${result.skipped} leg(s) left out because they start within 2 minutes.` : ""}
            {` Last match kicks off at ${lagos(result.lastKickoff)} Lagos; each match drops off once it starts.`}
          </p>
          <div className="row">
            <CopyButton text={result.code} />
          </div>
          <p className="status" style={{ marginTop: 8 }}>Opens the SportyBet app if it is installed, otherwise the website. Vig never places the bet.</p>
        </section>
      ) : <p className="note warn" role="alert">{result.error}</p>)}

      <ol className="picks">
        {legs.map((p) => (
          <PickRow key={p.id} p={p} actions={<>
            <button type="button" onClick={() => swap(p)}>Smart switch</button>
            <button type="button" onClick={() => remove(p)}>Remove</button>
          </>} />
        ))}
      </ol>

      {rest.length > 0 && (
        <details className="more">
          <summary>Add from {cands.length - legs.length} other selections</summary>
          <ol className="picks">
            {rest.map((p) => <PickRow key={p.id} p={p} actions={<button type="button" onClick={() => add(p)}>Add to slip</button>} />)}
          </ol>
        </details>
      )}
    </section>
  );
}
