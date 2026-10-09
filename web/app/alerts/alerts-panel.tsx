"use client";
import { useEffect, useState, useTransition } from "react";
import { pushPrefs, subscribePush, testPush, unsubscribePush } from "../push-actions";

const PRESETS = ["09:00", "13:00", "18:00", "20:00", "22:00"];

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "checking" | "unsupported" | "ios-install" | "off" | "denied" | "on";

export function AlertsPanel({ vapidKey, filters }: { vapidKey: string; filters: string }) {
  const [state, setState] = useState<State>("checking");
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [results, setResults] = useState(true);
  const [tips, setTips] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
        return setState(ios && !standalone ? "ios-install" : "unsupported");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const s = await reg.pushManager.getSubscription();
      if (Notification.permission === "denied") return setState("denied");
      if (!s) return setState("off");
      setSub(s);
      const p = await pushPrefs(s.endpoint);
      if (p) {
        setResults(p.results);
        setTips(p.tips);
      }
      setState("on");
    })().catch(() => setState("unsupported"));
  }, []);

  const save = (s: PushSubscription, r: boolean, t: string[], note: string) =>
    start(async () => {
      const res = await subscribePush(s.toJSON() as never, { results: r, tips: t });
      setMsg(res.ok ? note : res.error);
    });

  const enable = () =>
    start(async () => {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      let s: PushSubscription;
      try {
        const reg = await navigator.serviceWorker.ready;
        s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
      } catch (e) {
        return setMsg(`This browser could not register with its push service (${(e as Error).message}). Try again, or use Chrome.`);
      }
      const res = await subscribePush(s.toJSON() as never, { results, tips });
      if (!res.ok) return setMsg(res.error);
      setSub(s);
      setState("on");
      setMsg("Notifications are on for this device.");
    });

  const disable = () =>
    start(async () => {
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setSub(null);
      setState("off");
      setMsg("Notifications are off for this device.");
    });

  const toggleTip = (t: string) => {
    const next = tips.includes(t) ? tips.filter((x) => x !== t) : [...tips, t].sort();
    setTips(next);
    if (sub) save(sub, results, next, next.includes(t) ? `Tip added at ${t}.` : `Tip at ${t} removed.`);
  };

  if (state === "checking") return <p className="status">Checking this browser…</p>;
  if (state === "unsupported") return <p className="note">This browser cannot receive web notifications. Chrome or Samsung Internet on Android, or Safari on iPhone (from the Home Screen), can.</p>;
  if (state === "ios-install")
    return <p className="note">On iPhone, add Vig to your Home Screen first: tap Share, then Add to Home Screen. Open Vig from there and come back to this page.</p>;
  if (state === "denied")
    return <p className="note warn">Notifications are blocked for this site. Allow them in the browser&apos;s site settings, then reload.</p>;

  return (
    <div className="panel alerts">
      {state === "off" ? (
        <>
          <label className="check"><input type="checkbox" checked={results} onChange={(e) => setResults(e.target.checked)} /> When a code I book lands or loses</label>
          <button className="primary" type="button" onClick={enable} disabled={pending}>{pending ? "Turning on…" : "Turn on notifications"}</button>
        </>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={results} disabled={pending}
              onChange={(e) => { setResults(e.target.checked); if (sub) save(sub, e.target.checked, tips, e.target.checked ? "Code results on." : "Code results off."); }} />
            When a code I book lands or loses
          </label>
          <fieldset className="chipgroup">
            <legend>Send me a tip slip at (Lagos time)</legend>
            {[...new Set([...PRESETS, ...tips])].sort().map((t) => (
              <label key={t} className="chip">
                <input type="checkbox" checked={tips.includes(t)} onChange={() => toggleTip(t)} disabled={pending} />
                <span>{t}</span>
              </label>
            ))}
          </fieldset>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (/^\d\d:\d\d$/.test(custom) && !tips.includes(custom)) toggleTip(custom); setCustom(""); }}>
            <label className="field">Another time<input type="time" value={custom} onChange={(e) => setCustom(e.target.value)} /></label>
            <button type="submit" disabled={pending || !custom}>Add</button>
          </form>
          <p className="status">Tips use your last Tonight filters: {filters}. Build a slip on Tonight to change them, then come back and save.</p>
          <div className="row">
            <button type="button" disabled={pending} onClick={() => sub && save(sub, results, tips, "Saved with your current filters.")}>Save filters for tips</button>
            <button type="button" disabled={pending} onClick={() => sub && start(async () => setMsg((await testPush(sub.endpoint, "plain")) ? "Test sent." : "Could not send. Try turning notifications off and on."))}>Send a test</button>
            <button type="button" disabled={pending} onClick={() => sub && start(async () => setMsg((await testPush(sub.endpoint, "tip")) ? "Tip sent." : "Could not send."))}>Send a tip now</button>
            <button type="button" disabled={pending} onClick={disable}>Turn off</button>
          </div>
        </>
      )}
      <p className="status" role="status" aria-live="polite">{msg}</p>
    </div>
  );
}
