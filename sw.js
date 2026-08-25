const CACHE_NAME = 'trt-mobile-v2-10-media-gateway-fix';
const API_ORIGIN = 'https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net';
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

function mediaOperationForPath(pathname) {
  if (pathname === '/media/upload-url') return 'media_upload_url';
  if (pathname === '/media/complete') return 'media_complete';
  if (pathname === '/media/thumbnail-url') return 'media_thumbnail_url';
  if (pathname === '/media') return 'media_list';
  return '';
}

async function routeMediaThroughPublishedGateway(request, requestUrl) {
  const operation = mediaOperationForPath(requestUrl.pathname);
  if (!operation) return fetch(request);

  let body = {};
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      const text = await request.clone().text();
      if (text) body = JSON.parse(text);
    } catch (_) {
      body = {};
    }
  }
  body = { ...body, operation };

  const headers = new Headers();
  const authorization = request.headers.get('Authorization');
  if (authorization) headers.set('Authorization', authorization);
  headers.set('Content-Type', 'application/json');

  // /employees is already published in API Gateway. API v7.1.16+ multiplexes
  // media operations there, so mobile photo sync no longer depends on missing
  // standalone /media/* Gateway routes.
  return fetch(`${API_ORIGIN}/employees`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
    mode: 'cors'
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  // Repair only media-control API calls. Direct PUT to the signed Object Storage
  // URL is intentionally left untouched and uses the bucket CORS rule.
  if (
    requestUrl.origin === API_ORIGIN &&
    mediaOperationForPath(requestUrl.pathname)
  ) {
    event.respondWith(routeMediaThroughPublishedGateway(request, requestUrl));
    return;
  }

  if (request.method !== 'GET') return;

  // External requests (authorization, API, map tiles) are never cached.
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
