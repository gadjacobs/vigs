"use client";
import { useEffect, useState } from "react";
import { androidAppUrl, shareUrl } from "@/lib/share";

/**
 * "Open in SportyBet": on Android an intent link, so the code opens in the
 * SportyBet app when it's installed instead of the browser (some phones send
 * plain links to the browser); elsewhere the usual link.
 */
export function OpenInSportyBet({ code, className = "button primary", onClick, children }:
  { code: string; className?: string; onClick?: () => void; children?: React.ReactNode }) {
  const [href, setHref] = useState(shareUrl(code));
  useEffect(() => { if (/Android/i.test(navigator.userAgent)) setHref(androidAppUrl(code)); }, [code]);
  return <a className={className} href={href} onClick={onClick}>{children ?? "Open in SportyBet"}</a>;
}
