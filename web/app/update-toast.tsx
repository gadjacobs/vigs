"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LIVE_PAGES = new Set(["/", "/picks"]);
const EVERY = 90_000;

/**
 * Watches for a new deployment and, on Tonight and Our picks, for a newly
 * published round. Offers a reload in a dismissable toast; never reloads on
 * its own, so a slip being edited is never lost.
 */
export function UpdateToast({ build }: { build: string }) {
  const router = useRouter();
  const path = usePathname();
  const round = useRef<string | null>(null);
  const [kind, setKind] = useState<"build" | "round" | null>(null);
  const dismissed = useRef<string>("");

  // Keep the service worker current, so notification changes reach installed apps.
  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((r) => r.update()).catch(() => undefined);
  }, []);

  useEffect(() => {
    round.current = null;
    let stop = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const s = (await (await fetch("/api/status", { cache: "no-store" })).json()) as { build: string; round: string };
        if (stop) return;
        if (s.build && build !== "dev" && s.build !== build && dismissed.current !== `b${s.build}`) return setKind("build");
        if (!LIVE_PAGES.has(path) || !s.round) return;
        if (round.current === null) round.current = s.round;
        else if (s.round !== round.current && dismissed.current !== `r${s.round}`) setKind("round");
      } catch { /* offline: try again next time */ }
    };
    check();
    const t = setInterval(check, EVERY);
    document.addEventListener("visibilitychange", check);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [build, path]);

  if (!kind) return null;
  const reload = () => {
    setKind(null);
    if (kind === "build") location.reload();
    else {
      round.current = null;
      router.refresh();
    }
  };
  const close = async () => {
    try {
      const s = (await (await fetch("/api/status", { cache: "no-store" })).json()) as { build: string; round: string };
      dismissed.current = kind === "build" ? `b${s.build}` : `r${s.round}`;
    } catch { /* ignore */ }
    setKind(null);
  };
  return (
    <div className="toast" role="status" aria-live="polite">
      <p>{kind === "build" ? "A new version of Vig is ready." : "New matches have been published."}</p>
      <button type="button" className="primary" onClick={reload}>{kind === "build" ? "Reload" : "Refresh picks"}</button>
      <button type="button" className="x" onClick={close} aria-label="Dismiss">×</button>
    </div>
  );
}
