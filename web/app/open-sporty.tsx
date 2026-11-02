"use client";
import { useRef, useState } from "react";
import { shareUrl } from "@/lib/share";

/**
 * "Open in SportyBet": the plain share link. Phones with the SportyBet app open
 * it there (Android app links); an Android intent link opened SportyBet's own
 * in-app browser instead, so it is not used.
 *
 * The code is copied as the link opens, so if SportyBet lands on its home page
 * instead of the slip (it sometimes does), the code is already on the clipboard
 * to paste into its Booking Code box. The button says so for a moment.
 */
export function OpenInSportyBet({ code, className = "button primary", onClick, children }:
  { code: string; className?: string; onClick?: () => void; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <a className={className} href={shareUrl(code)} aria-live="polite"
      onClick={() => {
        onClick?.();
        // Started inside the tap, before the page hands over to SportyBet; a refusal changes nothing.
        navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 2500);
        }).catch(() => undefined);
      }}>
      {copied ? `${code} copied · opening…` : children ?? "Open in SportyBet"}
    </a>
  );
}
