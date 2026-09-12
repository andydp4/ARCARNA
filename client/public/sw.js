const SW_BASE = self.location.pathname.replace(/\/sw\.js$/i, "") || "";
const API_PREFIX = SW_BASE ? `${SW_BASE}/api` : "/api";

/** Bump when cache layout changes; activate deletes older arcarna-epos-* and midnight-epos-* caches.
 *  Bumped 5 -> 6 to force stale clients to drop cached app shell / API responses
 *  (fixes "saved but no change shown" caused by an old cached bundle).
 *  Bumped 6 -> 7 (N3a): the fetch handler now bypasses the Operations Centre
 *  board and any text/event-stream request instead of caching them — a
 *  client still running the old handler would answer the board from a stale
 *  cache and silently swallow the SSE stream's `text/event-stream` body into
 *  its API cache logic, which reads and re-serves it as ordinary JSON. */
const CACHE_VERSION = "7";
const CACHE_PREFIX = "arcarna-epos";
const LEGACY_CACHE_PREFIX = "midnight-epos";
const CACHE_NAME = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const API_CACHE_NAME = `${CACHE_PREFIX}-api-${CACHE_VERSION}`;

const SHELL_URL = SW_BASE ? `${SW_BASE}/` : "/";
const INDEX_URL = SW_BASE ? `${SW_BASE}/index.html` : "/index.html";
const PRECACHE_ASSETS = [SHELL_URL, INDEX_URL];

const ORG_CACHE_PARAM = "__arcarna_org";
const LEGACY_ORG_CACHE_PARAM = "__midnight_org";

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

function isApiRequest(pathname) {
  return pathname.startsWith(API_PREFIX) || pathname.startsWith("/api/");
}

/**
 * The Operations Centre board and its push stream (N3a).
 *
 * Both are checked by PATH — `/orders/board` and `/orders/board/stream` under
 * either base — plus, belt and braces, by the request's own `Accept` header
 * for ANY `text/event-stream` request this service worker does not yet know
 * the path of. Matched literally rather than by a broader "/orders" prefix so
 * this stays exactly the two endpoints the brief names, the same discipline
 * `server/security.ts`'s limiter skip list keeps.
 */
function isOpsBoardOrStreamRequest(request, pathname) {
  const boardPath = `${API_PREFIX}/orders/board`;
  if (pathname === boardPath || pathname === `${boardPath}/stream`) return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/event-stream");
}

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

async function cacheShellResponse(request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  if (request.url !== INDEX_URL) {
    await cache.put(INDEX_URL, response.clone());
  }
  if (request.url !== SHELL_URL) {
    await cache.put(SHELL_URL, response.clone());
  }
}

/** Offline-only fallback for SPA navigations — never reject. */
async function offlineNavigationFallback() {
  for (const url of [SHELL_URL, INDEX_URL]) {
    const cached = await caches.match(url);
    if (cached) return cached;
  }
  return new Response("Offline — reconnect to load ARCARNA EPOS.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Network-first for navigations; cache only when the network is unavailable. */
async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cacheShellResponse(request, response);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineNavigationFallback();
  }
}

/** Network-first for static assets; cache fallback on failure, never throw. */
async function handleAssetRequest(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("", { status: 404, statusText: "Not Found" });
  }
}

function isStaleBrandCache(cacheName) {
  const isCurrent =
    cacheName === CACHE_NAME || cacheName === API_CACHE_NAME;
  if (isCurrent) return false;
  const isArcarna =
    cacheName.startsWith(`${CACHE_PREFIX}-`) ||
    cacheName.startsWith(`${CACHE_PREFIX}-api-`);
  const isMidnight =
    cacheName.startsWith(`${LEGACY_CACHE_PREFIX}-`) ||
    cacheName.startsWith(`${LEGACY_CACHE_PREFIX}-api-`) ||
    cacheName === "midnight-epos-v3" ||
    cacheName === "midnight-epos-api-v3";
  return isArcarna || isMidnight;
}

self.addEventListener("install", (event) => {
  console.log("[Service Worker] Installing…", { base: SW_BASE, version: CACHE_VERSION });
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => {
        console.warn("[Service Worker] Precache partial/failed (offline install?):", err);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (isStaleBrandCache(cacheName)) {
            console.log("[Service Worker] Deleting stale cache:", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
      await self.clients.claim();
    })(),
  );
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
  const orgParam = encodeURIComponent(orgId);
  await Promise.all(
    keys
      .filter(
        (req) =>
          req.url.includes(`${ORG_CACHE_PARAM}=${orgParam}`) ||
          req.url.includes(`${LEGACY_ORG_CACHE_PARAM}=${orgParam}`),
      )
      .map((req) => cache.delete(req)),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  // Never intercepted, never cached, never even seen by the API branch below:
  // an SSE connection has to reach the network directly (the API branch
  // below buffers a whole response before deciding whether to cache it,
  // which would hang the stream open forever), and the board must always be
  // fresh — a cached 200 is exactly the "stale but still looks
  // authoritative" failure mode `sw.js`'s API branch exists to avoid for
  // ordinary GETs (finding G11), except here staleness is invisible until
  // someone acts on a card that has not actually moved.
  if (isOpsBoardOrStreamRequest(request, url.pathname)) {
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
    isNavigationRequest(request)
      ? handleNavigationRequest(request)
      : handleAssetRequest(request),
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
