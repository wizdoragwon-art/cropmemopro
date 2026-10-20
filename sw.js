// Crop Memo Pro — service worker (network-first shell, offline fallback)
// app.js 의 APP_VERSION 과 같은 값으로 맞춰 두면, 업데이트할 때 예전 캐시가 자동으로 정리됩니다
const CACHE = 'cropmemo-26.10.20-1408';
const SHELL = [
  './', './index.html', './app.js', './icons.js', './styles.css', './native-bridge.js',
  './manifest.webmanifest',
  './CropMemoPro_GAS_Code.gs',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

// 브라우저 HTTP 캐시를 건너뛰고 서버에서 직접 받는다.
//   c.add() / 평범한 fetch() 는 '브라우저 HTTP 캐시'를 먼저 본다. 호스팅이 Cache-Control: max-age 를
//   주면(깃허브 페이지는 600초) 새로 배포해도 예전 파일이 그대로 와서, 네트워크 우선이라는 말이 무색하게
//   옛 app.js 가 다시 캐시에 저장되고 홈 화면 버전정보도 바뀌지 않는다. cache:'reload' 로 항상 서버까지 간다.
function fetchFresh(input) {
  const req = (typeof input === 'string') ? input : input.url;
  return fetch(new Request(req, { cache: 'reload', credentials: 'same-origin' }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(
      SHELL.map((u) => fetchFresh(u).then((res) => { if (res && res.ok) return c.put(u, res); }))
    )).then(() => self.skipWaiting())
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
  return fetchFresh(req)
    .then((res) => putCache(req, res))
    .catch(() => fetch(req).then((res) => putCache(req, res)).catch(() => caches.match(req)));
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
  if (url.pathname.indexOf('/ocr/') !== -1 || url.pathname.indexOf('/pdf/') !== -1 || url.pathname.indexOf('/guide/') !== -1 || url.pathname.endsWith('xlsx.min.js') || url.pathname.indexOf('/icons/') !== -1) {
    e.respondWith(cacheFirst(req));
    return;
  }
  // app shell (html/js/css/json) + navigations: network-first so new deploys apply immediately; cache is offline fallback
  e.respondWith(networkFirst(req));
});
