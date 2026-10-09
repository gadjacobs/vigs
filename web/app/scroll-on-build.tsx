"use client";
import { useEffect } from "react";

/** After "Build slip", bring the result into view and flash it once. */
export function ScrollOnBuild({ target }: { target: string }) {
  useEffect(() => {
    const url = new URL(location.href);
    const run = Number(url.searchParams.get("run"));
    if (!run) return;
    url.searchParams.delete("run");
    history.replaceState(history.state, "", url.pathname + (url.search || ""));
    if (Date.now() - run > 60_000) return;
    const el = document.getElementById(target);
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.classList.add("flash");
    el.focus({ preventScroll: true });
    const t = setTimeout(() => el.classList.remove("flash"), 1600);
    return () => clearTimeout(t);
  }, [target]);
  return null;
}
