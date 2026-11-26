const CACHE_NAME = "quizgate-pwa-cache-v4";
const PRECACHE_ROUTES = [
  "/",
  "/auth",
  "/student",
  "/student/play",
  "/teacher",
  "/verify",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        PRECACHE_ROUTES.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
          return Promise.resolve(false);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CACHE_URLS" && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) =>
        Promise.allSettled(
          event.data.urls.map(async (url) => {
            try {
              const res = await fetch(url);
              if (res && res.ok) await cache.put(url, res);
            } catch {
              // Ignore offline warm miss
            }
          })
        )
      )
    );
  }

  // Version-tagged cache update for /q/<runId> student quiz links
  if (event.data && event.data.type === "CACHE_RUN_ROUTE" && typeof event.data.url === "string") {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const res = await fetch(event.data.url, { cache: "reload" });
          if (res && res.ok) {
            await cache.put(event.data.url, res.clone());
            if (event.data.versionHash) {
              await cache.put(`${event.data.url}?v=${encodeURIComponent(event.data.versionHash)}`, res);
            }
          }
        } catch {
          // Keep existing cached entry if offline
        }
      })
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Next.js immutable build chunks: Cache-First for instant offline boot
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // App pages, RSC requests & assets: Network-first with cached route fallback
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return res;
      })
      .catch(async () => {
        const exact = await caches.match(request);
        if (exact) return exact;

        const isRsc = url.searchParams.has("_rsc") || request.headers.get("RSC") === "1";
        if (!isRsc) {
          const pathMatch = await caches.match(url.pathname, { ignoreSearch: true });
          if (pathMatch) return pathMatch;
        } else {
          const keys = await caches.keys();
          for (const k of keys) {
            const cache = await caches.open(k);
            const cachedRequests = await cache.keys();
            const rscMatch = cachedRequests.find((cr) => {
              const cu = new URL(cr.url);
              return cu.pathname === url.pathname && cu.searchParams.has("_rsc");
            });
            if (rscMatch) {
              const hit = await cache.match(rscMatch);
              if (hit) return hit;
            }
          }
        }

        if (request.mode === "navigate") {
          if (url.pathname.startsWith("/q/")) {
            const qExact = await caches.match(url.pathname, { ignoreSearch: true });
            if (qExact) return qExact;
          }
          if (url.pathname.startsWith("/student/play")) {
            const playShell = await caches.match("/student/play", { ignoreSearch: true });
            if (playShell) return playShell;
          }
          const rootFallback = await caches.match("/");
          if (rootFallback) return rootFallback;
        }

        return new Response("Offline", { status: 503 });
      })
  );
});
