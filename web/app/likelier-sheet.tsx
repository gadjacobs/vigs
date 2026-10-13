"use client";
import { useEffect, useState } from "react";
import { bookRebuild, rebuildCode, type Rebuild } from "./likelier-actions";
import { rememberCode } from "./codes-panel";
import { CopyButton } from "./copy-button";
import { lagos } from "./pick-row";
import type { Rule } from "@/lib/likelier";
import { oneIn } from "@/lib/plain";
import { shareUrl } from "@/lib/share";

const RULES: [Rule, string][] = [["any", "Any market"], ["goals", "Goals only"], ["nodraw", "No draws"]];
const pct = (p: number) => (p >= 0.01 ? `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%` : `${(p * 100).toFixed(2)}%`);

/** Bottom sheet: the likeliest slip at the same payout as a code, and booking it. */
export function LikelierSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const [rule, setRule] = useState<Rule>("any");
  const [r, setR] = useState<Rebuild | null>(null);
  const [booked, setBooked] = useState<{ code: string } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setR(null);
    setBooked(null);
    rebuildCode(code, rule).then((x) => alive && setR(x)).catch(() => alive && setR({ ok: false, error: "That didn't work. Try again." }));
    return () => { alive = false; };
  }, [code, rule]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);

  const doBook = async () => {
    if (!r?.ok || !r.slip) return;
    setBusy(true);
    const res = await bookRebuild(r.slip.legs).catch((e) => ({ ok: false as const, error: (e as Error).message }));
    setBusy(false);
    if (!res.ok) return setBooked({ error: res.error });
    setBooked({ code: res.code });
    rememberCode({ code: res.code, at: Date.now(), legs: res.legs, odds: r.slip.odds, last: res.lastKickoff });
  };

  const o = r?.ok ? r.original : null, s = r?.ok ? r.slip : null;
  const times = o && s && o.chance ? s.chance / o.chance : null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet likelier" role="dialog" aria-modal="true" aria-labelledby="lk-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="lk-title">Make {code} likelier</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="segmented lk-rules" role="radiogroup" aria-label="Markets to use">
          {RULES.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={rule === v} onClick={() => setRule(v)}>{label}</button>
          ))}
        </div>

        {!r && <div className="lk-loading" role="status"><i className="spin" aria-hidden="true" /> Searching every match that finishes in time…</div>}
        {r && !r.ok && <p className="note">{r.error}</p>}
        {o && (
          <div className="lk-compare">
            <div className="lk-col">
              <span className="lk-tag">Your code</span>
              <b className="num">{o.chance !== null ? pct(o.chance) : "?"}</b>
              <small>{o.chance !== null ? oneIn(o.chance) : "chance unknown"}</small>
              <small>{o.legs} legs · odds <span className="num">{o.odds.toFixed(o.odds < 100 ? 2 : 0)}</span></small>
            </div>
            <span className="lk-arrow" aria-hidden="true">→</span>
            <div className={`lk-col ${s ? "better" : ""}`}>
              <span className="lk-tag">Rebuilt</span>
              {s ? <>
                <b className="num">{pct(s.chance)}</b>
                <small>{oneIn(s.chance)}</small>
                <small>{s.legs.length} legs · odds <span className="num">{s.odds.toFixed(s.odds < 100 ? 2 : 0)}</span></small>
              </> : <small>No slip reaches this payout in time.</small>}
            </div>
          </div>
        )}
        {o && s && (
          <p className="lk-verdict">
            {times && times > 1.02 ? <><strong>{times.toFixed(1)}× as likely</strong> to land for about the same payout.</>
              : <>Your code is already about as likely as anything at this payout.</>}
            {o.started ? ` ${o.started} leg${o.started > 1 ? "s" : ""} already started and stay${o.started > 1 ? "" : "s"} out.` : ""}
            {" "}Finishes by {lagos(r!.ok ? r!.finishBy : 0)}.
          </p>
        )}
        {s && (
          <ol className="lk-legs">
            {s.legs.map((l) => (
              <li key={l.eventId}>
                <span className="num lk-time">{lagos(l.kickoff)}</span>
                <span className="lk-match">{l.home} v {l.away}<small>{l.label} · {l.league}</small></span>
                <span className="num lk-odds">{l.odds.toFixed(2)}</span>
                <span className="lk-chance">{pct(l.chance)}</span>
              </li>
            ))}
          </ol>
        )}
        {s && (
          <div className="row">
            {booked && "code" in booked ? (
              <>
                <a className="button primary" href={shareUrl(booked.code)}>Open {booked.code} in SportyBet</a>
                <CopyButton text={booked.code} />
              </>
            ) : (
              <button type="button" className="primary" disabled={busy} onClick={doBook}>{busy ? "Booking…" : "Book this slip"}</button>
            )}
          </div>
        )}
        {booked && "code" in booked && <p className="status">Added to Codes, so Vig follows it live.</p>}
        {booked && "error" in booked && <p className="status">{booked.error}</p>}
        <p className="note muted">Chances are SportyBet&apos;s own prices with the margin taken out, which have matched results on our data.
          Fewer, fairer legs lose less to the bookmaker&apos;s cut; no slip pays back more than it costs on average.</p>
      </div>
    </div>
  );
}
