const CACHE_NAME = 'midnight-epos-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
];

const API_CACHE_NAME = 'midnight-epos-api-v1';
const OFFLINE_QUEUE_NAME = 'offline-queue';

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    if (!navigator.onLine) {
      event.respondWith(
        new Response(JSON.stringify({ error: 'Offline', message: 'Request queued for sync' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(API_CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
  } else {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request).then((response) => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });

            return response;
          });
        })
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncOfflineOrders());
  }
});

async function syncOfflineOrders() {
  console.log('[Service Worker] Syncing offline orders...');
  const db = await openDB();
  const tx = db.transaction('offline-orders', 'readonly');
  const store = tx.objectStore('offline-orders');
  const orders = await store.getAll();

  for (const order of orders) {
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order.data)
      });

      if (response.ok) {
        const deleteTx = db.transaction('offline-orders', 'readwrite');
        const deleteStore = deleteTx.objectStore('offline-orders');
        await deleteStore.delete(order.id);
        console.log('[Service Worker] Synced order:', order.id);
      }
    } catch (error) {
      console.error('[Service Worker] Failed to sync order:', error);
    }
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('midnight-epos-db', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('offline-orders')) {
        db.createObjectStore('offline-orders', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}
