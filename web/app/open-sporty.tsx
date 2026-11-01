import { shareUrl } from "@/lib/share";

/**
 * "Open in SportyBet": the plain share link. Phones with the SportyBet app open
 * it there (Android app links); an Android intent link opened SportyBet's own
 * in-app browser instead, so it is not used.
 */
export function OpenInSportyBet({ code, className = "button primary", onClick, children }:
  { code: string; className?: string; onClick?: () => void; children?: React.ReactNode }) {
  return <a className={className} href={shareUrl(code)} onClick={onClick}>{children ?? "Open in SportyBet"}</a>;
}
