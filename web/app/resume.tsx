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
    let hiddenAt = 0;
    const wake = (cover: boolean) => {
      if (cover) setVeil(true);
      start(() => router.refresh());
      window.dispatchEvent(new Event("vig-resume"));
    };
    const vis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 15_000) wake(Date.now() - hiddenAt > VEIL_AFTER);
    };
    const show = (e: PageTransitionEvent) => { if (e.persisted) wake(true); };
    document.addEventListener("visibilitychange", vis);
    addEventListener("pageshow", show);
    return () => { document.removeEventListener("visibilitychange", vis); removeEventListener("pageshow", show); };
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
