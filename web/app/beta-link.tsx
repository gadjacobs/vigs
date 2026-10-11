"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** "Beta" tag in the top bar: the way to send ideas and bugs from any page. */
export function BetaLink() {
  const path = usePathname();
  if (path === "/login" || path === "/welcome") return null;
  return <Link href="/feedback" className="betatag" aria-current={path === "/feedback" ? "page" : undefined}>Feedback</Link>;
}
