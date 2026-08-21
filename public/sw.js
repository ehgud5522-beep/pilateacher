/* 필라티쳐 Service Worker — 오프라인 캐싱 */
const CACHE = "pilateacher-v4";
const CORE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/PlayStore-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fall back to cached index (offline shell)
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // JS/CSS는 새 배포가 즉시 보이도록 network-first, 이미지류만 cache-first.
  const isCode = ["script", "style", "worker"].includes(req.destination);
  if (isCode) {
    e.respondWith(fetch(req).then((res) => {
      if (res?.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req).then((cached) => cached || fetch(req).then((res) => {
    if (res?.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone()));
    return res;
  })));
});
