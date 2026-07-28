const CACHE_NAME = 'trt-mobile-v1-11-task-card';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(SHELL.map(url => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('trt-mobile-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const requestUrl = new URL(request.url);

  // Внешние запросы, включая API авторизации и карты, никогда не кешируем.
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put('./', copy)).catch(() => null);
        return response;
      }).catch(async () =>
        await caches.match('./') || await caches.match('./index.html') || Response.error()
      )
    );
    return;
  }

  const mustRefresh =
    requestUrl.pathname.endsWith('/app.js') ||
    requestUrl.pathname.endsWith('/styles.css') ||
    requestUrl.pathname.endsWith('/index.html') ||
    requestUrl.pathname.endsWith('/manifest.webmanifest');

  if (mustRefresh) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => null);
        return response;
      }).catch(async () => await caches.match(request) || Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => null);
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
