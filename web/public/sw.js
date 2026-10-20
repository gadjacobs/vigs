// Vig service worker: shows push notifications and opens the app when one is tapped.
// v2: monochrome status-bar badge (Android draws the badge as a white silhouette,
// so a full-colour icon there shows as a blank square or the browser's logo).
const OFFLINE = "/offline.html";
const CACHE = "vig-v5";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

// Pages come from the network; with no connection, show Vig's own offline
// screen instead of the browser's.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== PREFS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

// How each kind of notification looks and buzzes. People pick "buzz" or "quiet"
// per kind in Settings; the page keeps that choice in the cache below, since a
// service worker can't read the page's storage. Sounds are the phone's own: a
// web app can't set one (Android: Settings > Apps > Chrome > Notifications).
const PREFS = "vig-prefs";
const KINDS = {
  landed: { icon: "/notify/landed.png", badge: "/notify/badge-landed.png", vibrate: [90, 50, 90, 50, 260], sticky: true, picture: true,
    actions: [{ action: "share", title: "Share the ticket" }, { action: "open", title: "Open Codes" }] },
  lost: { icon: "/notify/lost.png", badge: "/notify/badge-lost.png", vibrate: [220], actions: [{ action: "open", title: "Open Codes" }] },
  goal: { icon: "/notify/goal.png", badge: "/notify/badge-goal.png", vibrate: [40, 30, 40] },
  swing: { icon: "/notify/swing.png", badge: "/notify/badge-goal.png", vibrate: [60, 40, 60] },
  last: { icon: "/notify/swing.png", badge: "/badge-96.png", vibrate: [120, 60, 120] },
  match: { icon: "/notify/goal.png", badge: "/notify/badge-goal.png", vibrate: [40] },
};
const quietKinds = () => caches.open(PREFS).then((c) => c.match("/__notify"))
  .then((r) => (r ? r.json() : {})).catch(() => ({}));

// The ticket picture, fetched here with the signed-in session (the card is
// private) and handed over inline. Without it the notification still shows.
async function picture(code) {
  try {
    const r = await fetch(`/api/share/${encodeURIComponent(code)}`, { credentials: "include" });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  } catch {
    return null;
  }
}

function show(p) {
  const k = KINDS[p.kind] || (p.cheer ? KINDS.landed : null);
  return Promise.all([quietKinds(), k?.picture && p.code ? picture(p.code) : null]).then(([prefs, image]) => {
    const quiet = k && prefs[p.kind] === "quiet";
    return self.registration.showNotification(p.title, {
      body: p.body, tag: p.tag, icon: k?.icon || "/icon-192.png", badge: k?.badge || "/badge-96.png",
      data: { url: p.url, code: p.code, kind: p.kind },
      renotify: Boolean(p.tag) && !quiet, timestamp: Date.now(), silent: Boolean(quiet),
      ...(k && !quiet ? { vibrate: k.vibrate } : {}),
      ...(k?.sticky && !quiet ? { requireInteraction: true } : {}),
      // A landed code shows its ticket as the picture (Android shows it when expanded).
      ...(image ? { image } : {}),
      ...(k?.actions ? { actions: k.actions } : {}),
    });
  });
}

self.addEventListener("push", (event) => {
  let p = { title: "Vig", body: "", url: "/" };
  try {
    p = { ...p, ...event.data.json() };
  } catch {
    if (event.data) p.body = event.data.text();
  }
  event.waitUntil(show(p));
});

// Settings' "Try it" buttons: a sample of one kind, shown exactly as a real one.
const SAMPLES = {
  landed: { title: "🎉 V4EDQA landed!", body: "Every leg won: all 2 at 1.84 odds. Open SportyBet to see your payout." },
  lost: { title: "✗ MA154H lost", body: "ELC v BIL: over 0.5 is beaten at 0:0 (90'). 11 of 12 legs won." },
  goal: { title: "⚽ ARS 1–0 EVE (31')", body: "MA154H now 64% to land (was 52%)." },
};
self.addEventListener("message", (event) => {
  const kind = event.data?.preview;
  if (SAMPLES[kind]) event.waitUntil(show({ ...SAMPLES[kind], url: "/codes", kind, tag: `sample-${kind}` }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  // "Share the ticket" opens Codes with that code's share sheet up.
  const to = event.action === "share" && d.code ? `/codes?share=${encodeURIComponent(d.code)}` : d.url || "/";
  const url = new URL(to, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if (w.url.startsWith(self.location.origin) && "focus" in w) return w.navigate(url).then((c) => (c || w).focus());
      return self.clients.openWindow(url);
    }),
  );
});
