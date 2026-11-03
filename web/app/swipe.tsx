"use client";
import { useRef, useState } from "react";

const FAR = 96; // px past which a swipe acts
export const SWIPED_KEY = "vig_swiped"; // set once a swipe has been used, to retire the tip

/**
 * A list item that can be swiped sideways by touch: left for `onLeft`, right for
 * `onRight`. Vertical scrolling is left to the browser (touch-action: pan-y); a
 * tap that turned into a swipe never also clicks what was under the finger.
 */
export function SwipeLi({ className, onLeft, onRight, leftLabel, rightLabel, children }: {
  className: string; onLeft?: () => void; onRight?: () => void; leftLabel: string; rightLabel: string; children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; id: number; locked: boolean } | null>(null);
  const swiped = useRef(false);
  const reset = () => { start.current = null; setDragging(false); setDx(0); };
  const clamp = (x: number) => {
    if (x < 0 && !onLeft) return 0;
    if (x > 0 && !onRight) return 0;
    const a = Math.abs(x);
    return Math.sign(x) * (a <= FAR ? a : FAR + (a - FAR) * 0.35); // resistance past the line
  };
  const k = Math.min(1, Math.abs(dx) / FAR);
  return (
    <li className={`${className} swipeable ${dragging ? "dragging" : ""} ${dx < 0 ? "swipe-l" : dx > 0 ? "swipe-r" : ""} ${k >= 1 ? "armed" : ""}`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, "--k": k } as React.CSSProperties}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        swiped.current = false;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, locked: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const mx = e.clientX - s.x, my = e.clientY - s.y;
        if (!s.locked) {
          if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) { start.current = null; return; } // a scroll
          if (Math.abs(mx) < 12 || Math.abs(mx) < Math.abs(my) * 1.4) return;
          s.locked = true;
          setDragging(true);
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine without */ }
        }
        setDx(clamp(mx));
      }}
      onPointerUp={() => {
        const s = start.current;
        if (s?.locked) {
          swiped.current = true;
          const acted = dx <= -FAR || dx >= FAR;
          if (dx <= -FAR) { navigator.vibrate?.(15); onLeft?.(); }
          else if (dx >= FAR) { navigator.vibrate?.(15); onRight?.(); }
          if (acted) { try { localStorage.setItem(SWIPED_KEY, "1"); } catch { /* private mode */ } dispatchEvent(new Event("vig-swiped")); }
        }
        reset();
      }}
      onPointerCancel={reset}
      onClickCapture={(e) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; } }}
    >
      {dx !== 0 && <span className={`swipehint ${dx < 0 ? "l" : "r"}`} aria-hidden="true">{dx < 0 ? leftLabel : rightLabel}</span>}
      {children}
    </li>
  );
}
