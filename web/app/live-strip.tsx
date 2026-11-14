"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Tracked } from "@/lib/codes";
import type { LiveLeg } from "@/lib/live";
import { liveCodes } from "./codes-api";
import { isFinal, readHidden, readOpen } from "./code-store";
import { codeChance, effective, legKey } from "./code-live";

// While a leg of one of your codes is playing, a thin strip under the header on
// every page (Codes shows it all already): how many codes are live, the leading
// one's chance, and the latest score. Read fresh from SportyBet's live feed every
// 15 seconds; never shown from an old reading.

type Shown = { codes: number; lead: { code: string; chance: number | null }; line: string; goal: boolean };
const HIDE = ["/codes", "/login", "/welcome", "/onboarding"];

export function LiveStrip() {
  const path = usePathname();
  const [shown, setShown] = useState<Shown | null>(null);
  const scores = useRef<Record<string, string>>({});
  const goalUntil = useRef<{ line: string; until: number } | null>(null);
  const off = HIDE.some((h) => path === h || path.startsWith(`${h}/`));

  useEffect(() => {
    if (off) { setShown(null); return; }
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      const hidden = readHidden();
      // Codes seen on Codes, still open, with a leg that has kicked off in the last 40 minutes.
      const open = Object.values(readOpen(now)).filter((t): t is Tracked => !t.foreign && !hidden.has(t.code) && !isFinal(t, now)
        && t.legs.some((l) => (l.status === "waiting" || l.status === "playing") && l.kickoff <= now + 60_000 && l.kickoff > now - 40 * 60_000));
      if (!open.length) { setShown(null); return; }
      const refs = open.flatMap((t) => t.legs.filter((l) => l.status === "waiting" || l.status === "playing")
        .map((l) => ({ eventId: l.eventId, market: l.market, kickoff: l.kickoff })));
      const res = await liveCodes(refs).catch(() => null);
      if (stop || !res) return;
      const live = open.filter((t) => !t.legs.some((l) => effective(l, res) === "lost") && t.legs.some((l) => res[legKey(l)]?.state === "playing"));
      if (!live.length) { setShown(null); return; }
      // A score that changed since the last reading is a goal: it leads for 20 seconds.
      let line = "";
      for (const t of live) for (const l of t.legs) {
        const x = res[legKey(l)];
        if (x?.state !== "playing" || !x.score) continue;
        const txt = `${l.home} ${x.score.replace(":", "–")} ${l.away}${x.phase === "HT" ? " HT" : x.minute !== null ? ` ${x.minute}'` : ""}`;
        if (scores.current[l.eventId] !== undefined && scores.current[l.eventId] !== x.score) goalUntil.current = { line: `⚽ ${txt}`, until: now + 20_000 };
        scores.current[l.eventId] = x.score;
        if (!line) line = txt;
      }
      const goal = Boolean(goalUntil.current && goalUntil.current.until > now);
      const ranked = live.map((t) => ({ code: t.code, chance: codeChance(t, res) })).sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1));
      setShown({ codes: live.length, lead: ranked[0], line: goal ? goalUntil.current!.line : line, goal });
    };
    tick();
    const t = setInterval(tick, 15_000);
    const vis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [off]);

  if (off || !shown) return null;
  const pct = shown.lead.chance === null ? null : shown.lead.chance >= 0.995 && shown.lead.chance < 1 ? ">99" : String(Math.round(shown.lead.chance * 100));
  return (
    <Link href="/codes" className={`livestrip ${shown.goal ? "goal" : ""}`} aria-live="polite">
      <i className="livedot" aria-hidden="true" />
      <b>{shown.codes === 1 ? shown.lead.code : `${shown.codes} codes live`}</b>
      {pct !== null && <span className="num">{shown.codes === 1 ? "" : `${shown.lead.code} `}{pct}%</span>}
      {shown.line && <span className="ls-line">{shown.line}</span>}
      <span className="ls-go" aria-hidden="true">›</span>
    </Link>
  );
}
