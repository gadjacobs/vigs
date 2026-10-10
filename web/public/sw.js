// Vig service worker: shows push notifications and opens the app when one is tapped.
// v2: monochrome status-bar badge (Android draws the badge as a white silhouette,
// so a full-colour icon there shows as a blank square or the browser's logo).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let p = { title: "Vig", body: "", url: "/" };
  try {
    p = { ...p, ...event.data.json() };
  } catch {
    if (event.data) p.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body, tag: p.tag, icon: "/icon-192.png", badge: "/badge-96.png", data: { url: p.url },
      renotify: Boolean(p.tag), timestamp: Date.now(),
    }),
  );
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
