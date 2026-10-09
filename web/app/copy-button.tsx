"use client";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
      >
        Copy code
      </button>
      <span role="status" aria-live="polite">{copied ? "Copied" : ""}</span>
    </>
  );
}
