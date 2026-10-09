"use client";
import { useState } from "react";
import { saveTheme } from "./profile-actions";

const OPTIONS = [
  { value: "system", label: "Auto", short: "A", scheme: "light dark", color: "" },
  { value: "light", label: "Day", short: "☀", scheme: "only light", color: "#fbfbf6" },
  { value: "dark", label: "Floodlit", short: "☾", scheme: "dark", color: "#133629" },
] as const;

/** Keep the browser's colour-scheme and toolbar colour in step with the choice. */
function syncMeta(o: (typeof OPTIONS)[number]) {
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", o.scheme);
  const dark = o.value === "dark" || (o.value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", o.color || (dark ? "#133629" : "#fbfbf6"));
    m.removeAttribute("media");
  });
}

export function ThemeToggle({ initial }: { initial: string }) {
  const [theme, setTheme] = useState(initial);
  const choose = (v: string) => {
    setTheme(v);
    document.cookie = `vig_theme=${v}; path=/; max-age=31536000; samesite=lax`;
    if (v === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
    syncMeta(OPTIONS.find((o) => o.value === v)!);
    saveTheme(v as "system" | "light" | "dark").catch(() => undefined);
  };
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} aria-label={o.label}
          title={o.label} onClick={() => choose(o.value)}>
          <span className="full">{o.label}</span><span className="short" aria-hidden="true">{o.short}</span>
        </button>
      ))}
    </div>
  );
}
