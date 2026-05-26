const SW_BASE = self.location.pathname.replace(/\/sw\.js$/i, "") || "";
const API_PREFIX = SW_BASE ? `${SW_BASE}/api` : "/api";

const CACHE_NAME = "midnight-epos-v2";
const PRECACHE_ASSETS = [
  SW_BASE ? `${SW_BASE}/` : "/",
  SW_BASE ? `${SW_BASE}/index.html` : "/index.html",
];

const API_CACHE_NAME = "midnight-epos-api-v2";

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
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
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
  const db = await openDB();
  const tx = db.transaction("offline-orders", "readonly");
  const store = tx.objectStore("offline-orders");
  const orders = await store.getAll();

  for (const order of orders) {
    try {
      const response = await fetch(`${API_PREFIX}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order.data),
      });

      if (response.ok) {
        const deleteTx = db.transaction("offline-orders", "readwrite");
        await deleteTx.objectStore("offline-orders").delete(order.id);
      }
    } catch (error) {
      console.error("[Service Worker] Failed to sync order:", error);
    }
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("midnight-epos-db", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("offline-orders")) {
        db.createObjectStore("offline-orders", { keyPath: "id", autoIncrement: true });
      }
    };
  });
}
