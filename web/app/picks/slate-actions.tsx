"use client";
import { useState } from "react";
import { rememberCode } from "../codes-panel";
import { adoptCode } from "../push-actions";
import { ShareButton } from "../share-sheet";
import { shareUrl } from "@/lib/share";

type Props = { code: string; legs: number; odds: number; last: number; style: string };

/** Open or copy a cooked slip's code; either one adds it to your Codes and your record. */
export function SlateActions({ code, legs, odds, last, style }: Props) {
  const [copied, setCopied] = useState(false);
  const keep = () => {
    rememberCode({ code, at: Date.now(), legs, odds, last });
    adoptCode(code, style).catch(() => undefined);
  };
  return (
    <>
      <strong className="num slatecode">{code}</strong>
      <a className="button primary" href={shareUrl(code)} onClick={keep}>Open in SportyBet</a>
      <button type="button" onClick={async () => {
        keep();
        try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no clipboard */ }
      }}>{copied ? "Copied" : "Copy code"}</button>
      <span onClickCapture={keep}><ShareButton code={code} /></span>
    </>
  );
}
