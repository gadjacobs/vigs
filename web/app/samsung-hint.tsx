"use client";
import { useEffect, useState } from "react";

const KEY = "vig_samsung_hint";

/**
 * Samsung Internet's dark mode repaints pages with its own colours, even when a
 * page declares its colour scheme (and inside an app installed from it). Only
 * the browser setting turns that off, so tell Samsung users once how.
 */
export function SamsungHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(/SamsungBrowser/.test(navigator.userAgent) && !localStorage.getItem(KEY));
    } catch {
      setShow(/SamsungBrowser/.test(navigator.userAgent));
    }
  }, []);
  if (!show) return null;
  const close = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ }
    setShow(false);
  };
  return (
    <aside className="note samsung" role="note" aria-label="Colours on Samsung Internet">
      <p>
        <strong>Colours look off?</strong> Samsung Internet&apos;s dark mode repaints sites with its own colours. Vig
        has its own Floodlit theme, so let Vig choose: in Samsung Internet open Menu (☰) → Settings → Labs (or
        Appearance on newer versions) and turn on <strong>Use website dark theme</strong>. Or switch the browser to
        Light mode from the Menu. Opening Vig in Chrome and installing it from there also avoids it.
      </p>
      <button type="button" onClick={close}>Got it</button>
    </aside>
  );
}
