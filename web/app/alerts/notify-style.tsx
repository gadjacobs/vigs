"use client";
import { useEffect, useState } from "react";

// How each kind of notification arrives on this device: with its buzz, or quiet.
// Kept on the device (each phone can differ) and in a cache the service worker reads.
const KINDS = [
  ["landed", "Landed", "Gold tick, a drum-roll buzz, the ticket picture and a Share button. Stays until you clear it."],
  ["lost", "Lost", "Red cross, one long buzz."],
  ["goal", "Goals", "Ball icon, a quick double tap."],
] as const;
type Style = "buzz" | "quiet";
const KEY = "vig_notify_style";

async function store(prefs: Record<string, Style>) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  const quiet = Object.fromEntries(Object.entries(prefs).filter(([, v]) => v === "quiet"));
  // "goal" covers big swings and followed matches too.
  if (quiet.goal) Object.assign(quiet, { swing: "quiet", match: "quiet" });
  const c = await caches.open("vig-prefs");
  await c.put("/__notify", new Response(JSON.stringify(quiet), { headers: { "Content-Type": "application/json" } }));
}

export function NotifyStyle() {
  const [prefs, setPrefs] = useState<Record<string, Style>>({});
  useEffect(() => {
    try { setPrefs(JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch { /* private mode */ }
  }, []);
  const choose = (k: string, v: Style) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    store(next).catch(() => undefined);
  };
  const tryIt = async (k: string) => {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    reg?.active?.postMessage({ preview: k });
  };
  return (
    <fieldset className="setgroup notifystyle">
      <legend>How each one arrives</legend>
      {KINDS.map(([k, label, hint]) => (
        <div key={k} className="nstyle">
          <img src={`/notify/${k}.png`} alt="" width={40} height={40} />
          <span><strong>{label}</strong><small>{hint}</small></span>
          <div className="segmented" role="radiogroup" aria-label={`${label} notifications`}>
            {(["buzz", "quiet"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={(prefs[k] ?? "buzz") === v} onClick={() => choose(k, v)}>
                {v === "buzz" ? "Buzz" : "Quiet"}
              </button>
            ))}
          </div>
          <button type="button" className="linkish trybtn" onClick={() => tryIt(k)}>Try it</button>
        </div>
      ))}
      <small className="muted">The sound is your phone&apos;s: web apps can&apos;t choose one. On Android, set it under Settings › Apps › Chrome › Notifications.</small>
    </fieldset>
  );
}
