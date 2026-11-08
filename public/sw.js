// Gamelle : garde l'appli en cache pour qu'elle s'ouvre même sans réseau.
// Ce fichier remplace aussi l'ancien service worker publicitaire de l'ancien site
// chez les visiteurs qui l'avaient encore.
const CACHE = "gamelle-v2";
const FILES = [
  "/", "/index.html", "/app.css", "/app.js", "/manifest.webmanifest", "/icon.svg",
  "/fonts/bricolage-grotesque-latin-700-normal.woff2", "/fonts/bricolage-grotesque-latin-800-normal.woff2",
  "/fonts/figtree-latin-400-normal.woff2", "/fonts/figtree-latin-500-normal.woff2", "/fonts/figtree-latin-600-normal.woff2",
  "/fonts/dm-mono-latin-400-normal.woff2", "/fonts/dm-mono-latin-500-normal.woff2"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (dernière version), cache en secours. Uniquement nos propres fichiers.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
