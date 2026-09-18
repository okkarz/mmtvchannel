/* ============================================================================
   Service worker — app shell cache.
   • Never caches video segments or playlists (live streams must stay live).
   • Optional: when a CORS proxy is configured, requests to that origin are
     passed through untouched so the proxy can add its own CORS headers.
   ========================================================================= */
const VERSION = 'mmtv-v1.0.5';
const SHELL = `${VERSION}-shell`;

/** Everything needed to boot the UI offline. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data/channels.js',
  './vendor/hls.min.js',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/logos/mrtv.png',
  './assets/logos/mrtvnews.png',
  './assets/logos/mrtv-sports.png',
  './assets/logos/mrtv-farmer.png',
  './assets/logos/mrtv-nrc.png',
  './assets/logos/mrtv-ent.png',
  './assets/logos/mrtv4.png',
  './assets/logos/mitv.png',
  './assets/logos/hluttaw.png',
  './assets/logos/mahar.png',
  './assets/logos/mahar-esports.png',
  './assets/logos/maharbawdi.png',
  './assets/logos/dvb.png',
  './assets/logos/fortune.png',
  './assets/logos/channel7.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll fails the whole install if any single asset 404s, so add individually.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch { /* ignore */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** Anything that looks like a live stream must always hit the network. */
function isStreamRequest(url) {
  // The bundled proxy reassembles stream URLs into its query string, so its
  // responses are live media too — never cache or intercept them.
  if (url.pathname.startsWith('/api/')) return true;
  return /\.m3u8(\?|$)/i.test(url.pathname) ||
         /\.ts(\?|$)/i.test(url.pathname) ||
         /\.m4s(\?|$)/i.test(url.pathname) ||
         /\.mp4(\?|$)/i.test(url.pathname) ||
         /\.key(\?|$)/i.test(url.pathname) ||
         /wmsAuthSign|nimblesessionid|LiveApp|playlist\.m3u8|chunks\.m3u8/i.test(url.href);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Streams, proxied traffic and range requests bypass the cache entirely.
  if (isStreamRequest(url) || request.headers.has('range')) return;

  // Navigation: serve the cached shell instantly, refresh in the background.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Same-origin assets: cache-first, then revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(request, { ignoreSearch: false });
      if (hit) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(request);
            if (fresh && fresh.ok) await cache.put(request, fresh.clone());
          } catch { /* offline */ }
        })());
        return hit;
      }
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
  }
  // Cross-origin (logos from a CDN, etc.): let the network handle it.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
