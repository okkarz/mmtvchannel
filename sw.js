/* ============================================================================
   Service worker — app shell cache.
   • Code (HTML/JS/CSS) is network-first, so a deploy always reaches the viewer.
     Serving it cache-first previously broke the app: the HTML updated while
     app.js came from the cache, and the two disagreed. Offline playback is not
     a meaningful loss for live TV, so freshness wins.
   • Media (logos, fonts, hls.js) is cache-first — that content is stable.
   • Never caches video segments or playlists (live streams must stay live).
   ========================================================================= */
const VERSION = 'mmtv-v1.1.1';
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

/**
 * Is this part of the *code* (as opposed to media)?
 *
 * Code must always be fetched fresh. Serving it cache-first caused a real
 * breakage: the HTML updated but `app.js` came from the cache, so the new
 * markup and the old script disagreed and the app threw on load. Offline
 * playback is not a meaningful loss for live TV, so freshness wins.
 */
function isShellCode(url) {
  return /\.(?:html|js|mjs|css|json|webmanifest)$/i.test(url.pathname) ||
         url.pathname === '/' ||
         url.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Streams, proxied traffic and range requests bypass the cache entirely.
  if (isStreamRequest(url) || request.headers.has('range')) return;

  /* ── Code: network first, fall back to cache when offline ─────────────── */
  if (request.mode === 'navigate' || (url.origin === self.location.origin && isShellCode(url))) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok && fresh.type !== 'opaqueredirect') {
          const cache = await caches.open(SHELL);
          cache.put(request, fresh.clone());
          return fresh;
        }
        return fresh;
      } catch {
        // Offline — serve whatever was last cached, else the shell.
        const cache = await caches.open(SHELL);
        return (await cache.match(request)) ||
               (await cache.match('./index.html')) ||
               Response.error();
      }
    })());
    return;
  }

  /* ── Media (logos, fonts, vendored libs): cache first ─────────────────── */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(request, { ignoreSearch: false });
      if (hit) return hit;
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
