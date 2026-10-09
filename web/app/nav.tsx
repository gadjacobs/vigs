"use client";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Tonight" },
  { href: "/record", label: "Record" },
  { href: "/alerts", label: "Alerts" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="mainnav">
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>{l.label}</a>
      ))}
    </nav>
  );
}
