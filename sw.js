const CACHE = "mandelbrot-ultradeep-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./worker.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const req = event.request;
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (req.method === "GET" && new URL(req.url).origin === location.origin) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone()).catch(()=>{});
    }
    return res;
  })());
});
