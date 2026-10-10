"use client";
import { useEffect, useState } from "react";
import { bookHedge, hedgeQuote, type HedgeQuote } from "./live-actions";
import { CopyButton } from "./copy-button";
import { hedgePlan, stakeUp } from "@/lib/hedge";
import { MARKET_LABELS } from "@/lib/markets";
import { shareUrl } from "@/lib/share";

const DC_LABELS: Record<string, string> = { DC1X: "Home or draw", DC12: "Home or away", DCX2: "Draw or away" };
const naira = (x: number) => `₦${Math.round(x).toLocaleString("en-NG")}`;
const signed = (x: number) => `${x < 0 ? "−" : "+"}${naira(Math.abs(x))}`;

export type HedgeLeg = { eventId: string; market: string; kickoff: number; home: string; away: string; label: string };

/** Bottom sheet: cover the last open leg of a slip with the opposite selection. */
export function HedgeSheet({ code, leg, odds, stake: initialStake, onClose }: {
  code: string; leg: HedgeLeg; odds: number | null; stake: number; onClose: () => void;
}) {
  const [stake, setStake] = useState(String(initialStake));
  const [payout, setPayout] = useState(odds ? String(Math.round(initialStake * odds)) : "");
  const [q, setQ] = useState<HedgeQuote | undefined>(undefined);
  const [booked, setBooked] = useState<{ code: string } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => hedgeQuote(leg.eventId, leg.market, leg.kickoff).then((r) => alive && setQ(r)).catch(() => alive && setQ(null));
    load();
    // Live prices move about every 13 seconds.
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { alive = false; clearInterval(t); removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [leg, onClose]);

  const s = Number(stake), pay = Number(payout);
  const ok = q && s > 0 && pay > s;
  const plan = ok ? hedgePlan(s, pay, q.odds, q.chance) : null;
  const oppLabel = q ? DC_LABELS[q.market] ?? MARKET_LABELS[q.market] ?? q.market : "";

  const doBook = async () => {
    setBusy(true);
    setBooked(await bookHedge(leg.eventId, leg.market).catch((e) => ({ error: (e as Error).message })));
    setBusy(false);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="hedge-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="hedge-title">Hedge {code}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="note">Last leg: <strong>{leg.home} v {leg.away}</strong>, {leg.label.toLowerCase()}.
          {q ? <> Covered by <strong>{oppLabel}</strong> at <strong className="num">{q.odds.toFixed(2)}</strong>{q.live ? " (live price)" : ""}.</> : null}</p>
        <div className="row hedge-inputs">
          <label className="field">Slip stake (₦)
            <input type="number" inputMode="numeric" min={1} value={stake} onChange={(e) => setStake(e.target.value)} />
          </label>
          <label className="field">Pays if it lands (₦)
            <input type="number" inputMode="numeric" min={1} value={payout} onChange={(e) => setPayout(e.target.value)}
              placeholder={odds ? "" : "From your SportyBet slip"} />
          </label>
        </div>
        {q === undefined && <p className="status">Getting SportyBet&apos;s price…</p>}
        {q === null && <p className="status">SportyBet isn&apos;t taking bets on the opposite selection right now: it pauses markets after goals and closes very one-sided ones. Try again shortly.</p>}
        {q && !ok && <p className="status">Enter the stake and what the slip pays.</p>}
        {plan && q && (
          <ul className="hedge-options">
            <li>
              <strong>Keep it</strong>
              <span>{q.chance !== null ? <>{Math.round(q.chance * 100)}% chance of {signed(pay - s)}, else {signed(-s)}. On average {signed(plan.hold.average!)}.</> : <>{signed(pay - s)} if it lands, else {signed(-s)}.</>}</span>
            </li>
            <li>
              <strong>Same result either way</strong>
              <span>Stake <b className="num">{naira(stakeUp(plan.cover.stake))}</b> on {oppLabel.toLowerCase()}: about <b>{signed(plan.cover.net)}</b> whichever way it goes.
                {plan.coverCost !== null && plan.coverCost > 0 && <> Gives up {naira(plan.coverCost)} on average, SportyBet&apos;s margin on the hedge.</>}</span>
            </li>
            {plan.back && (
              <li>
                <strong>Get your stake back</strong>
                <span>Stake <b className="num">{naira(stakeUp(plan.back.stake))}</b>: level if the leg fails, {signed(plan.back.ifLands)} if it lands.</span>
              </li>
            )}
          </ul>
        )}
        {q && (
          <div className="row">
            {booked && "code" in booked ? (
              <>
                <a className="button primary" href={shareUrl(booked.code)}>Open {booked.code} in SportyBet</a>
                <CopyButton text={booked.code} />
              </>
            ) : (
              <button type="button" className="primary" disabled={busy} onClick={doBook}>{busy ? "Booking…" : `Book ${oppLabel.toLowerCase()} as a code`}</button>
            )}
          </div>
        )}
        {booked && "error" in booked && <p className="status">{booked.error}</p>}
        <p className="note muted">The price moves every few seconds and SportyBet may change it when you place the bet; enter your stake there.
          Hedging lowers the risk, not the cost: you pay the bookmaker&apos;s margin twice.</p>
      </div>
    </div>
  );
}
