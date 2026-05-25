/**
 * sw.js - ZenMatrix Service Worker
 * Enables offline execution, caching of static assets, and instant launching.
 */

const CACHE_NAME = 'zenmatrix-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icon.svg'
];

// Install Event - Pre-cache core application shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching offline assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up stale caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache version:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Intercept resource requests to deliver offline capability
self.addEventListener('fetch', (event) => {
  // Bypass caching for external Google API and local sync endpoints
  if (
    event.request.url.includes('googleapis.com') || 
    event.request.url.includes('accounts.google.com') || 
    event.request.url.includes('/sync/')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Serve static asset directly from cache
          return cachedResponse;
        }

        // Otherwise, fetch from the network
        return fetch(event.request).then((networkResponse) => {
          // Verify valid response before caching
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          // Cache newly fetched resource on the fly
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        }).catch((err) => {
          console.log('[Service Worker] Fetch failed, network offline:', err);
          // Return index shell as generic fallback for navigations
          if (event.request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
      })
  );
});
