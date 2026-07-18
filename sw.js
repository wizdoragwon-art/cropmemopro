// Crop Memo Pro — service worker (network-first shell, offline fallback)
const CACHE = 'cropmemo-v3';
const SHELL = [
  './', './index.html', './app.js', './icons.js', './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putCache(req, res) {
  if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}
function networkFirst(req) {
  return fetch(req).then((res) => putCache(req, res)).catch(() => caches.match(req));
}
function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    const net = fetch(req).then((res) => putCache(req, res)).catch(() => cached);
    return cached || net;
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // sync backend: always network, never cache
  if (url.hostname.indexOf('script.google') !== -1 || url.hostname.indexOf('googleusercontent') !== -1) return;
  // cross-origin: leave to browser
  if (url.origin !== self.location.origin) return;
  // big lazy assets + static icons: cache-first (download once, then offline)
  if (url.pathname.indexOf('/ocr/') !== -1 || url.pathname.indexOf('/pdf/') !== -1 || url.pathname.endsWith('xlsx.min.js') || url.pathname.indexOf('/icons/') !== -1) {
    e.respondWith(cacheFirst(req));
    return;
  }
  // app shell (html/js/css/json) + navigations: network-first so new deploys apply immediately; cache is offline fallback
  e.respondWith(networkFirst(req));
});
