"use client";
import { useState } from "react";

/** Copies the code; the button itself says "Copied" for a moment, so nothing shifts beside it. */
export function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-live="polite"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { return; }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
