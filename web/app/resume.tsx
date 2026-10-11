"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** When the app comes back to the foreground (or back from the browser's
 * cache), fetch fresh data: pages re-render and Codes re-reads its codes, so
 * nobody has to pull to refresh. */
export function Resume() {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt = 0;
    const wake = () => {
      router.refresh();
      window.dispatchEvent(new Event("vig-resume"));
    };
    const vis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 15_000) wake();
    };
    const show = (e: PageTransitionEvent) => { if (e.persisted) wake(); };
    document.addEventListener("visibilitychange", vis);
    addEventListener("pageshow", show);
    return () => { document.removeEventListener("visibilitychange", vis); removeEventListener("pageshow", show); };
  }, [router]);
  return null;
}
