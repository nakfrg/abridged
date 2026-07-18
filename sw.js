/* Abridged service worker — stale-while-revalidate app shell, offline-capable. */
/* Bump VERSION and the ?v= query in index.html together whenever app.css/app.js change. */
const VERSION = 'abridged-v9';
const SHELL = [
  './',
  './index.html',
  './app.css?v=9',
  './app.js?v=9',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Navigations: serve the shell so the app opens offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  const sameOrigin = url.origin === location.origin;
  const isFont = url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (!sameOrigin && !isFont) return;

  // Stale-while-revalidate: instant offline-capable response, refreshed for next load.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(request);
      const live = fetch(request)
        .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
        .catch(() => hit);
      return hit || live;
    })
  );
});
