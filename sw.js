const CACHE = "povitria-v3";
const CORE_ASSETS = ["./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls (fresh weather data), cache-first for the app shell.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const isApi = url.includes("open-meteo.com");
  if (isApi) return; // let the browser handle live data requests normally

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ---- Real push notifications (arrive even when the app/tab is fully closed) ----
self.addEventListener("push", (event) => {
  let data = { title: "Повітря", body: "Нове сповіщення." };
  try{ if(event.data) data = event.data.json(); }catch(e){ /* keep default */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: data.tag || "povitria",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type: "window"}).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes("index.html") || c.url.endsWith("/"));
      if(existing) return existing.focus();
      return self.clients.openWindow("./index.html");
    })
  );
});
