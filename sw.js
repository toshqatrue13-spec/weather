const CACHE = "povitria-v1";
const CORE_ASSETS = ["./povitria.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

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
