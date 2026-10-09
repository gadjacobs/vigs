"use client";
import { useState } from "react";

const OPTIONS = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Day" },
  { value: "dark", label: "Floodlit" },
] as const;

export function ThemeToggle({ initial }: { initial: string }) {
  const [theme, setTheme] = useState(initial);
  const choose = (v: string) => {
    setTheme(v);
    document.cookie = `vig_theme=${v}; path=/; max-age=31536000; samesite=lax`;
    if (v === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
  };
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} onClick={() => choose(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
