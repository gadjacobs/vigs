"use client";
import { usePathname } from "next/navigation";

const I = (d: string) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const LINKS = [
  { href: "/", label: "Tonight", icon: I("M4 6h16M4 12h16M4 18h10") },
  { href: "/picks", label: "Our picks", icon: I("M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z") },
  { href: "/codes", label: "Codes", icon: I("M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 9h6M9 13h6") },
  { href: "/record", label: "Record", icon: I("M4 19V5M4 19h16M8 15l3-4 3 2 5-6") },
  { href: "/alerts", label: "Alerts", icon: I("M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0") },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="mainnav">
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
          {l.icon}<span>{l.label}</span>
        </a>
      ))}
    </nav>
  );
}
