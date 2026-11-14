"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

// Away longer than this, the page's odds and kick-off times may have moved on:
// it is covered by a loading veil until the fresh page arrives.
const VEIL_AFTER = 60_000;

/** When the app comes back to the foreground (or back from the browser's
 * cache), fetch fresh data: pages re-render and Codes re-reads its codes, so
 * nobody has to pull to refresh, and nobody acts on old numbers meanwhile. */
export function Resume() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [veil, setVeil] = useState(false);
  useEffect(() => {
    // A heartbeat every 5 s. iOS freezes timers while a Home Screen app is in the
    // background and doesn't always say when it comes back, so the gap between
    // beats is what tells us the app was away, whichever event (or none) arrives.
    let beat = Date.now();
    let busyUntil = 0;
    const check = () => {
      const now = Date.now(), away = now - beat;
      beat = now;
      if (document.visibilityState !== "visible" || away < 15_000 || now < busyUntil) return;
      busyUntil = now + 5_000; // focus, visibility and pageshow often fire together
      if (away > VEIL_AFTER) setVeil(true);
      start(() => router.refresh());
      window.dispatchEvent(new Event("vig-resume"));
    };
    const t = setInterval(check, 5_000);
    const hide = () => { if (document.visibilityState === "hidden") beat = Date.now(); };
    // Back from the browser's page cache counts as away, however short.
    const show = (e: PageTransitionEvent) => { if (e.persisted) { beat = 0; check(); } };
    document.addEventListener("visibilitychange", check);
    document.addEventListener("visibilitychange", hide);
    addEventListener("focus", check);
    addEventListener("online", check);
    addEventListener("pageshow", show);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
      document.removeEventListener("visibilitychange", hide);
      removeEventListener("focus", check);
      removeEventListener("online", check);
      removeEventListener("pageshow", show);
    };
  }, [router]);
  // The veil lifts when the refresh lands (or after 15 s, so a dead connection never traps the page).
  useEffect(() => {
    if (!veil) return;
    if (!pending) { const t = setTimeout(() => setVeil(false), 150); return () => clearTimeout(t); }
    const t = setTimeout(() => setVeil(false), 15_000);
    return () => clearTimeout(t);
  }, [veil, pending]);
  if (!veil) return null;
  return (
    <div className="resumeveil" role="status" aria-live="polite">
      <i className="spin" aria-hidden="true" />
      <span>Getting the latest odds…</span>
    </div>
  );
}
