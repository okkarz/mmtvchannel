/**
 * Myanmar TV — CORS proxy for HLS streams (Cloudflare Worker)
 * ---------------------------------------------------------------------------
 * Why this exists
 *   Some broadcasters refuse browser playback in ways a web page cannot fix:
 *     • no `Access-Control-Allow-Origin` header
 *     • a `Referer` allow-list that rejects your own site
 *     • plain HTTP streams, blocked as mixed content on an HTTPS page
 *   A small server-side hop solves all three.
 *
 * Deploy (free tier, ~1 minute)
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. Paste this file's contents, then Deploy
 *   3. Copy the *.workers.dev URL into the app's Settings → CORS proxy URL
 *
 * Usage
 *   GET https://<your-worker>.workers.dev/?url=<url-encoded absolute stream URL>
 *
 * What it does
 *   • fetches the upstream resource with a browser User-Agent and a Referer
 *     matching the stream's own origin (which is what the CDNs expect)
 *   • rewrites .m3u8 playlists so every nested URI (segments, keys, init
 *     maps, alternate renditions) is routed back through the proxy too —
 *     without this, relative URIs would resolve against the proxy host and 404
 *   • passes through Range requests so seeking and segment fetches work
 *   • adds permissive CORS headers to the response
 */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Range,Origin,Accept,Content-Type,User-Agent,X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Content-Type,Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

function cors(extra) {
  return Object.assign({}, CORS_HEADERS, extra || {});
}

/** Absolute-ise a URI against a base, leaving already-absolute URIs alone. */
function absolute(uri, base) {
  try {
    return new URL(uri, base).href;
  } catch {
    return uri;
  }
}

/** Is this response an HLS playlist that needs URI rewriting? */
function looksLikePlaylist(contentType, text) {
  if (contentType && /mpegurl|x-mpegURL/i.test(contentType)) return true;
  return typeof text === 'string' && text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U');
}

/**
 * Rewrite every URI inside a playlist so it points back at this proxy.
 * Handles both plain URI lines and URI="..." attributes on tags such as
 * #EXT-X-KEY, #EXT-X-MAP and #EXT-X-MEDIA.
 */
function rewritePlaylist(text, baseUrl, proxyBase) {
  const wrap = (uri) => `${proxyBase}?url=${encodeURIComponent(absolute(uri, baseUrl))}`;

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        // Rewrite URI="..." attributes, if present on this tag.
        if (!/URI="/i.test(line)) return line;
        return line.replace(/URI="([^"]*)"/gi, (_match, uri) => `URI="${wrap(uri)}"`);
      }

      // A bare URI line (media segment, variant playlist, key file…).
      return wrap(trimmed);
    })
    .join('\n');
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: cors() });
    }

    const target = url.searchParams.get('url');
    if (!target) {
      return new Response(
        'Myanmar TV CORS proxy.\n\nUsage: ' + url.origin + '/?url=<absolute stream url>\n',
        { status: 200, headers: cors({ 'Content-Type': 'text/plain; charset=utf-8' }) },
      );
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('Bad "url" parameter', { status: 400, headers: cors() });
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return new Response('Only http(s) targets are allowed', { status: 400, headers: cors() });
    }

    // Present ourselves the way the broadcaster's CDN expects.
    const upstreamHeaders = new Headers({
      'User-Agent': BROWSER_UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: targetUrl.origin + '/',
      Origin: targetUrl.origin,
    });
    const range = request.headers.get('Range');
    if (range) upstreamHeaders.set('Range', range);

    let upstream;
    try {
      upstream = await fetch(targetUrl.href, {
        method: request.method,
        headers: upstreamHeaders,
        redirect: 'follow',
        // HLS is live; never let an edge cache serve a stale playlist.
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch (error) {
      return new Response(`Upstream fetch failed: ${error && error.message}`, {
        status: 502,
        headers: cors({ 'Content-Type': 'text/plain; charset=utf-8' }),
      });
    }

    const contentType = upstream.headers.get('Content-Type') || '';
    const proxyBase = `${url.origin}${url.pathname}`;
    const passthrough = {
      'Content-Type': contentType || 'application/octet-stream',
      'Cache-Control': 'no-store',
    };
    const contentRange = upstream.headers.get('Content-Range');
    if (contentRange) passthrough['Content-Range'] = contentRange;
    const acceptRanges = upstream.headers.get('Accept-Ranges');
    if (acceptRanges) passthrough['Accept-Ranges'] = acceptRanges;

    // Playlists are small text files — read, rewrite, return.
    if (/mpegurl|\.m3u8/i.test(contentType) || /\.m3u8(\?|$)/i.test(targetUrl.pathname + targetUrl.search)) {
      const text = await upstream.text();
      if (looksLikePlaylist(contentType, text)) {
        return new Response(rewritePlaylist(text, upstream.url || targetUrl.href, proxyBase), {
          status: upstream.status,
          headers: cors(Object.assign({}, passthrough, { 'Content-Type': 'application/vnd.apple.mpegurl' })),
        });
      }
      return new Response(text, { status: upstream.status, headers: cors(passthrough) });
    }

    // Everything else (segments, keys, images) streams straight through.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: cors(passthrough),
    });
  },
};
