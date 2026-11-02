"use client";
import { useEffect, useState } from "react";
import { dailyNet, lagosDay, naira, signed, slipReturn, tally, todayAgainst, type MoneyEntry } from "@/lib/money";
import { readLimit, readMoney } from "./money-store";

// My money: stakes you enter on Codes, what they paid back, and an optional
// daily limit. Numbers you type, never read from SportyBet.

/** This device's entries and limit, kept current as they change. */
export function useMoney(): { entries: MoneyEntry[]; limit: number } {
  const [s, setS] = useState<{ entries: MoneyEntry[]; limit: number }>({ entries: [], limit: 0 });
  useEffect(() => {
    const load = () => setS({ entries: readMoney(), limit: readLimit() });
    load();
    addEventListener("vig-money", load);
    return () => removeEventListener("vig-money", load);
  }, []);
  return s;
}

function useEsc(onClose: () => void) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
}

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** The week or month at a glance: net, staked, paid back, a bar per day, and today against the limit. */
export function MoneyPanel({ entries, limit, onLimit, now }: { entries: MoneyEntry[]; limit: number; onLimit: () => void; now: number }) {
  const [span, setSpan] = useState<7 | 30>(7);
  const t = tally(entries, lagosDay(now) - (span - 1) * 86_400_000);
  const bars = dailyNet(entries, now, 7);
  const top = Math.max(1, ...bars.map((b) => Math.abs(b.net)));
  const today = todayAgainst(entries, limit, now);
  const any = entries.some((e) => e.stake > 0);
  return (
    <section className="money" aria-labelledby="money-title">
      <div className="money-head">
        <h2 id="money-title">My money</h2>
        <div className="seg2" role="radiogroup" aria-label="Period">
          {([7, 30] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={span === s} onClick={() => setSpan(s)}>{s} days</button>
          ))}
        </div>
      </div>
      {!any ? (
        <p className="money-empty">Tap <b>Add stake</b> on a code after you place it in SportyBet. Vig adds up what you staked and what came back, so you always know where you stand.</p>
      ) : (<>
        <div className="money-main">
          <div className={`money-net ${t.net > 0 ? "up" : t.net < 0 ? "down" : ""}`}>
            <span className="num">{signed(t.net)}</span>
            <small>{t.net > 0 ? "up" : t.net < 0 ? "down" : "level"} over {span} days, settled codes</small>
          </div>
          <div className="money-bars" role="img" aria-label={`Net per day, last 7 days: ${bars.map((b) => signed(b.net)).join(", ")}`}>
            {bars.map((b) => (
              <span key={b.day} className={b.net > 0 ? "up" : b.net < 0 ? "down" : "zero"}>
                <i style={{ height: `${Math.max(6, (Math.abs(b.net) / top) * 100)}%` }} />
                <em>{DAYS[(new Date(b.day + 3600_000).getUTCDay() + 6) % 7]}</em>
              </span>
            ))}
          </div>
        </div>
        <dl className="money-stats">
          <div><dt>Staked</dt><dd className="num">{naira(t.staked)}</dd></div>
          <div><dt>Paid back</dt><dd className="num">{naira(t.back)}</dd></div>
          <div><dt>Still open</dt><dd className="num">{naira(t.open)}</dd></div>
          <div><dt>Best win</dt><dd className="num">{t.best ? signed(t.best) : "–"}</dd></div>
        </dl>
      </>)}
      <button type="button" className={`money-limit ${today.over ? "over" : ""}`} onClick={onLimit}>
        {limit ? (<>
          <span>Today <b className="num">{naira(today.staked)}</b> of your <b className="num">{naira(limit)}</b> limit</span>
          <span className="limitbar" aria-hidden="true"><i style={{ width: `${Math.min(100, (today.staked / limit) * 100)}%` }} /></span>
        </>) : <span>Today <b className="num">{naira(today.staked)}</b> staked · <u>Set a daily limit</u></span>}
      </button>
    </section>
  );
}

/** On a code card: your stake and what it pays, or a prompt to add it. */
export function StakeChip({ entry, legOdds, odds, onEdit }: { entry?: MoneyEntry; legOdds: number[]; odds: number | null; onEdit: () => void }) {
  if (!entry || !entry.stake)
    return <button type="button" className="stakechip add" onClick={onEdit}><span aria-hidden="true">＋</span> Add stake</button>;
  const pays = legOdds.length ? entry.stake * slipReturn(legOdds) : odds ? entry.stake * odds : null;
  return (
    <button type="button" className={`stakechip ${entry.back === null ? "" : entry.back > 0 ? "won" : "lost"}`} onClick={onEdit}
      aria-label={`Your stake ${naira(entry.stake)}. Change`}>
      <span className="num">{naira(entry.stake)}</span>
      {entry.back === null ? (pays ? <><span aria-hidden="true">→</span><b className="num">{naira(pays)}</b><small>if it lands</small></> : null)
        : entry.back > 0 ? <><span aria-hidden="true">→</span><b className="num">{naira(entry.back)}</b><small>paid · {signed(entry.back - entry.stake)}</small></>
        : <small>lost</small>}
    </button>
  );
}

/** Enter or change a code's stake (and, once settled, what it paid back). */
export function StakeSheet({ code, entry, settled, defaultStake, limit, todayStaked, onSave, onClose }: {
  code: string; entry?: MoneyEntry; settled: boolean; defaultStake: number; limit: number; todayStaked: number;
  onSave: (stake: number, back: number | null) => void; onClose: () => void;
}) {
  useEsc(onClose);
  const [stake, setStake] = useState(String(entry?.stake || defaultStake));
  const [back, setBack] = useState(entry?.back !== null && entry?.back !== undefined ? String(entry.back) : "");
  const n = Math.round(Number(stake.replace(/[^\d.]/g, "")) || 0);
  const before = todayStaked - (entry?.stake ?? 0);
  const over = limit > 0 && before + n > limit;
  const presets = [...new Set([defaultStake, 100, 500, 1000, 2000, 5000])].sort((a, b) => a - b).slice(0, 6);
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="stake-title" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); const b = back.trim() === "" ? null : Math.round(Number(back.replace(/[^\d.]/g, "")) || 0); onSave(n, settled ? b : null); }}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="stake-title">Your stake on <span className="num">{code}</span></h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="presets" role="group" aria-label="Quick amounts">
          {presets.map((p) => <button key={p} type="button" aria-pressed={n === p} onClick={() => setStake(String(p))}>{naira(p)}</button>)}
        </div>
        <label className="field">Amount staked (₦)
          <input type="text" inputMode="numeric" value={stake} onChange={(e) => setStake(e.target.value)} autoFocus />
        </label>
        {settled && (
          <label className="field">Paid back (₦)
            <input type="text" inputMode="numeric" value={back} onChange={(e) => setBack(e.target.value)} placeholder="Worked out for you" />
            <small className="hint">Leave empty and Vig works it out (odds with SportyBet&apos;s bonus if it landed, 0 if it lost). Type the amount for Flex or a cash-out.</small>
          </label>
        )}
        {over && <p className="note warn" role="alert">This takes today to {naira(before + n)}, over your {naira(limit)} daily limit.</p>}
        <div className="sheet-actions">
          <button type="submit" className="button primary" disabled={!n}>Save</button>
          {entry?.stake ? <button type="button" className="danger-ghost" onClick={() => onSave(0, null)}>I didn&apos;t place it</button> : null}
        </div>
      </form>
    </div>
  );
}

/** Set or clear the daily limit. */
export function LimitSheet({ limit, onSave, onClose }: { limit: number; onSave: (n: number) => void; onClose: () => void }) {
  useEsc(onClose);
  const [v, setV] = useState(limit ? String(limit) : "");
  const n = Math.round(Number(v.replace(/[^\d.]/g, "")) || 0);
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="limit-title" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSave(n); }}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="limit-title">Daily limit</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="lede">The most you mean to stake in a day (Lagos time). Vig warns you when a stake you enter, or a slip you book, would go past it.</p>
        <div className="presets" role="group" aria-label="Quick amounts">
          {[2000, 5000, 10000, 20000, 50000].map((p) => <button key={p} type="button" aria-pressed={n === p} onClick={() => setV(String(p))}>{naira(p)}</button>)}
        </div>
        <label className="field">Limit (₦)
          <input type="text" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} placeholder="No limit" />
        </label>
        <div className="sheet-actions">
          <button type="submit" className="button primary">{n ? "Save limit" : "No limit"}</button>
          {limit ? <button type="button" className="danger-ghost" onClick={() => onSave(0)}>Remove limit</button> : null}
        </div>
      </form>
    </div>
  );
}

/** Next to a Book button: a word when today's stakes have reached the daily limit. */
export function LimitNote() {
  const { entries, limit } = useMoney();
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);
  if (!limit || !now) return null;
  const t = todayAgainst(entries, limit, now);
  if (!t.over && (t.left ?? 0) > limit * 0.2) return null;
  return (
    <p className={`limitnote ${t.over ? "over" : ""}`} role="status">
      {t.over ? <>You&apos;ve staked {naira(t.staked)} today, at or over your {naira(limit)} limit.</>
        : <>{naira(t.left ?? 0)} left of today&apos;s {naira(limit)} limit.</>}
    </p>
  );
}
