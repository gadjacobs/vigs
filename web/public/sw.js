// Vig service worker: shows push notifications and opens the app when one is tapped.
// v2: monochrome status-bar badge (Android draws the badge as a white silhouette,
// so a full-colour icon there shows as a blank square or the browser's logo).
const OFFLINE = "/offline.html";
const CACHE = "vig-v4";

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
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

// Updates about one code or one followed match stack into a single notification:
// the newest on top, the earlier ones listed under it (shown when expanded), so
// the shade holds one entry per code instead of one per goal.
const STACK = /^(code|match)-/;
const MAX_LINES = 5;

self.addEventListener("push", (event) => {
  let p = { title: "Vig", body: "", url: "/" };
  try {
    p = { ...p, ...event.data.json() };
  } catch {
    if (event.data) p.body = event.data.text();
  }
  event.waitUntil((async () => {
    let body = p.body, lines = [];
    if (p.tag && STACK.test(p.tag)) {
      const [old] = await self.registration.getNotifications({ tag: p.tag });
      const before = old ? (old.data?.lines ?? [{ title: old.title, body: old.body }]) : [];
      lines = [...before, { title: p.title, body: p.body }].slice(-20);
      if (lines.length > 1) {
        const earlier = lines.slice(0, -1).reverse();
        const shown = earlier.slice(0, MAX_LINES - 1).map((l) => `• ${l.title}`);
        const more = earlier.length - shown.length;
        body = [p.body, "", `Earlier (${earlier.length}):`, ...shown, ...(more > 0 ? [`and ${more} more`] : [])].join("\n");
      }
    }
    await self.registration.showNotification(p.title, {
      body, tag: p.tag, icon: "/icon-192.png", badge: "/badge-96.png", data: { url: p.url, lines },
      renotify: Boolean(p.tag), timestamp: Date.now(),
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if (w.url.startsWith(self.location.origin) && "focus" in w) return w.navigate(url).then((c) => (c || w).focus());
      return self.clients.openWindow(url);
    }),
  );
});
