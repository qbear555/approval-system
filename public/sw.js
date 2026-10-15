/**
 * 線上簽核系統 - PWA Service Worker
 * - 靜態 App Shell 與字型快取
 * - API 請求絕對維持 Network-First，保障簽核狀態與權限即時性
 */
const CACHE_NAME = 'approval-pwa-v2';
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/img/icon.svg',
  '/img/argo-logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. 只攔截同一來源的 GET 請求
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // 2. /api/、/uploads/、/web-apps 等動態與簽核路徑一律走網路，不快取以維護資料即時性
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/web-apps') ||
    url.pathname.startsWith('/doc/')
  ) {
    return;
  }

  // 3. 靜態資產 (assets, fonts, img) 採用 Stale-While-Revalidate
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/img/') ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 4. HTML 頁面導航：Network-First，若離線則以快取的 App Shell 顯示
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match('/');
      })
    );
  }
});
