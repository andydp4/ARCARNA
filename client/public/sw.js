const SW_BASE = self.location.pathname.replace(/\/sw\.js$/i, "") || "";
const API_PREFIX = SW_BASE ? `${SW_BASE}/api` : "/api";

const CACHE_NAME = "midnight-epos-v3";
const PRECACHE_ASSETS = [
  SW_BASE ? `${SW_BASE}/` : "/",
  SW_BASE ? `${SW_BASE}/index.html` : "/index.html",
];

const API_CACHE_NAME = "midnight-epos-api-v3";
const ORG_CACHE_PARAM = "__midnight_org";

function orgIdFromRequest(request) {
  return request.headers.get("X-Org-Id") || "_no_org";
}

/** Cache key isolates API responses per tenant (X-Org-Id). */
function cacheRequestForOrg(request) {
  const url = new URL(request.url);
  url.searchParams.set(ORG_CACHE_PARAM, orgIdFromRequest(request));
  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    mode: request.mode,
    credentials: request.credentials,
    cache: request.cache,
    redirect: request.redirect,
    referrer: request.referrer,
    integrity: request.integrity,
  });
}

self.addEventListener("install", (event) => {
  console.log("[Service Worker] Installing…", { base: SW_BASE });
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        }),
      ),
    ),
  );
  return self.clients.claim();
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data.type !== "string") return;

  if (data.type === "CLEAR_ORG_CACHE" && data.orgId) {
    event.waitUntil(clearOrgApiCache(String(data.orgId)));
  } else if (data.type === "CLEAR_ALL_CACHES") {
    event.waitUntil(
      Promise.all([caches.delete(CACHE_NAME), caches.delete(API_CACHE_NAME)]),
    );
  }
});

async function clearOrgApiCache(orgId) {
  const cache = await caches.open(API_CACHE_NAME);
  const keys = await cache.keys();
  const prefix = `${ORG_CACHE_PARAM}=${encodeURIComponent(orgId)}`;
  await Promise.all(
    keys
      .filter((req) => req.url.includes(prefix))
      .map((req) => cache.delete(req)),
  );
}

function isApiRequest(pathname) {
  return pathname.startsWith(API_PREFIX) || pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (isApiRequest(url.pathname)) {
    const cacheKey = cacheRequestForOrg(request);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE_NAME).then((cache) => {
              cache.put(cacheKey, responseClone);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(cacheKey).then(
            (cachedResponse) =>
              cachedResponse ??
              new Response(JSON.stringify({ error: "Offline", cached: false }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }),
          ),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cachedResponse) =>
        cachedResponse ??
        fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        }),
    ),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "sync-orders") {
    event.waitUntil(syncOfflineOrders());
  }
});

async function syncOfflineOrders() {
  console.warn("[Service Worker] sync-orders uses client IndexedDB; no-op in SW");
}
