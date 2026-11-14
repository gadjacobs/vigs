"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Pull down at the top of any screen to reload it: the page's data from the
// server, and on Codes every open code and its live scores. In the Home Screen
// app there is no browser bar to refresh from (iOS has no pull to refresh there,
// and the app turns Android's off so it can't fire mid-scroll), so this is it.

const ARM = 70;  // px of pull that arms a refresh
const MAX = 110; // px the indicator travels at most

export function PullRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const pullRef = useRef(0);
  const until = useRef(0);

  useEffect(() => {
    // Only where nothing else offers it: the installed app, on a touch screen.
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone || !matchMedia("(pointer: coarse)").matches) return;
    const blocked = (t: EventTarget | null) =>
      t instanceof Element && Boolean(t.closest(".sheet, .sheet-backdrop, input, textarea, select, [data-no-pull]"));
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) { startY.current = null; return; }
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
    };
    const move = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = Math.abs(e.touches[0].clientX - startX.current);
      // A sideways swipe (a code card's stake / remove) is never a pull.
      if (dx > 12 && dx > dy) { startY.current = null; pullRef.current = 0; setPull(0); setDragging(false); return; }
      if (dy <= 0 || window.scrollY > 0) { if (pullRef.current) { pullRef.current = 0; setPull(0); setDragging(false); } return; }
      // Resistance: the further the pull, the less it moves.
      const p = Math.min(MAX, dy * 0.55);
      pullRef.current = p;
      setDragging(true);
      setPull(p);
    };
    const up = () => {
      const armed = pullRef.current >= ARM;
      startY.current = null;
      pullRef.current = 0;
      setDragging(false);
      if (!armed) { setPull(0); return; }
      navigator.vibrate?.(10);
      setBusy(true);
      setPull(ARM);
      until.current = Date.now() + 700; // long enough to see it happen
      start(() => router.refresh());
      window.dispatchEvent(new Event("vig-resume"));
    };
    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchmove", move, { passive: true });
    addEventListener("touchend", up);
    addEventListener("touchcancel", up);
    return () => {
      removeEventListener("touchstart", down);
      removeEventListener("touchmove", move);
      removeEventListener("touchend", up);
      removeEventListener("touchcancel", up);
    };
  }, [router]);

  // Done when the page has reloaded (and at least 0.7 s has passed); 15 s at most.
  useEffect(() => {
    if (!busy) return;
    if (pending) { const t = setTimeout(() => { setBusy(false); setPull(0); }, 15_000); return () => clearTimeout(t); }
    const t = setTimeout(() => { setBusy(false); setPull(0); }, Math.max(150, until.current - Date.now()));
    return () => clearTimeout(t);
  }, [busy, pending]);

  if (!pull && !busy) return null;
  return (
    <div className={`ptr ${dragging ? "dragging" : ""} ${pull >= ARM && !busy ? "armed" : ""} ${busy ? "busy" : ""}`}
      style={{ "--pull": pull, "--o": Math.min(1, pull / 40) } as React.CSSProperties} role="status" aria-live="polite">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
      </svg>
      <span className="sr-only">{busy ? "Refreshing" : pull >= ARM ? "Release to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
