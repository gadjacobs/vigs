"use client";
import { useState } from "react";

const COPY = "M9 9h10v10H9zM5 15V5h10";
const DONE = "M5 12.5l4.5 4.5L19 7.5";

/** Copies the code; the button itself says "Copied" for a moment, so nothing shifts beside it.
 * `icon`: a square icon button (label for screen readers only). */
export function CopyButton({ text, label = "Copy code", icon = false }: { text: string; label?: string; icon?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-live="polite"
      className={icon ? `iconbtn ${copied ? "done" : ""}` : undefined}
      aria-label={icon ? (copied ? "Copied" : `Copy ${text}`) : undefined}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { return; }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {icon
        ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={copied ? DONE : COPY} /></svg>
        : copied ? "Copied ✓" : label}
    </button>
  );
}
