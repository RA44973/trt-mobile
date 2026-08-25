const CACHE_NAME = 'trt-mobile-v2-11-task-photo-inline-transport';
const API_ORIGIN = 'https://d5dukure58mpc70n6ftu.uvah0e6r.apigw.yandexcloud.net';
const INLINE_UPLOAD_PATH = '/__vog_media_inline_upload';
const INLINE_RAW_LIMIT = 1650 * 1024;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

const inlineFallbackUrls = new Map();

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

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
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

  const response = await fetch(`${API_ORIGIN}/employees`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
    mode: 'cors'
  });

  // Task/visit photos use a same-origin synthetic PUT. The Mobile app can keep
  // its existing upload flow, while the Service Worker sends compact photo bytes
  // to the Cloud Function through the already-published /employees route.
  if (
    operation === 'media_upload_url' &&
    response.ok &&
    String(body.type || '').toLowerCase().startsWith('image/')
  ) {
    try {
      const payload = await response.clone().json();
      const mediaId = String(payload.media_id || payload.mediaId || body.id || '');
      if (payload.upload_url && mediaId && !payload.already_uploaded) {
        inlineFallbackUrls.set(mediaId, payload.upload_url);
        payload.upload_url = `${self.location.origin}${INLINE_UPLOAD_PATH}?mediaId=${encodeURIComponent(mediaId)}`;
        payload.headers = {
          'Content-Type': String(body.type || 'image/jpeg'),
          ...(authorization ? { 'Authorization': authorization } : {})
        };
        payload.transport = 'inline_server_bridge_v2_11';
        return jsonResponse(payload, response.status);
      }
    } catch (_) {
      // If response parsing fails, preserve the existing signed-URL path.
    }
  }

  return response;
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function compactJpegForInline(blob) {
  if (blob.size <= INLINE_RAW_LIMIT) return blob;
  if (
    !String(blob.type || '').toLowerCase().includes('jpeg') ||
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas !== 'function'
  ) {
    return blob;
  }

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
    const attempts = [
      [1280, 0.72],
      [1100, 0.68],
      [960, 0.64],
      [800, 0.60]
    ];
    let best = blob;
    for (const [maxSide, quality] of attempts) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) break;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const candidate = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (candidate.size < best.size) best = candidate;
      if (candidate.size <= INLINE_RAW_LIMIT) return candidate;
    }
    return best;
  } catch (_) {
    return blob;
  } finally {
    try { bitmap?.close?.(); } catch (_) {}
  }
}

async function handleInlinePhotoPut(request, requestUrl) {
  const mediaId = String(requestUrl.searchParams.get('mediaId') || '');
  if (!mediaId) return new Response('mediaId is required', { status: 400 });

  const authorization = request.headers.get('Authorization') || '';
  let blob = await request.clone().blob();
  blob = await compactJpegForInline(blob);

  if (blob.size > INLINE_RAW_LIMIT) {
    const fallbackUrl = inlineFallbackUrls.get(mediaId) || '';
    if (fallbackUrl) {
      return fetch(fallbackUrl, {
        method: 'PUT',
        headers: { 'Content-Type': request.headers.get('Content-Type') || blob.type || 'image/jpeg' },
        body: blob
      });
    }
    return new Response('Photo is too large for inline transport', { status: 413 });
  }

  if (!authorization) {
    return new Response('Authorization is required', { status: 401 });
  }

  const dataBase64 = bytesToBase64(await blob.arrayBuffer());
  const response = await fetch(`${API_ORIGIN}/employees`, {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      operation: 'media_upload_inline_existing',
      mediaId,
      dataBase64
    }),
    cache: 'no-store',
    mode: 'cors'
  });

  if (!response.ok) {
    return response;
  }

  let payload = {};
  try { payload = await response.clone().json(); } catch (_) {}
  inlineFallbackUrls.delete(mediaId);
  return new Response('', {
    status: 200,
    headers: {
      'ETag': String(payload?.media?.etag || '')
    }
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (
    requestUrl.origin === self.location.origin &&
    requestUrl.pathname === INLINE_UPLOAD_PATH &&
    request.method === 'PUT'
  ) {
    event.respondWith(handleInlinePhotoPut(request, requestUrl));
    return;
  }

  // Media-control API calls are multiplexed through /employees, an API Gateway
  // route already used in production. This does not affect TRT/map requests.
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
