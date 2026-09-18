/**
 * Myanmar TV — CORS proxy as a Vercel serverless function
 * ---------------------------------------------------------------------------
 * Why this exists
 *   Some broadcasters block direct browser playback in ways a web page cannot
 *   fix: no `Access-Control-Allow-Origin`, a `Referer` allow-list that rejects
 *   your own site, or plain HTTP (blocked as mixed content on an HTTPS page).
 *
 *   Deploying this alongside the app means the site works fully on Vercel with
 *   no separate account or service to set up. The app detects it automatically.
 *
 * Usage
 *   GET /api/proxy?url=<url-encoded absolute stream URL>
 *
 * Behaviour
 *   • fetches upstream with a browser User-Agent and a Referer matching the
 *     stream's own origin (which is what the CDNs expect)
 *   • rewrites .m3u8 playlists so every nested URI (segments, keys, init maps,
 *     alternate renditions) routes back through this proxy — without that,
 *     relative URIs would resolve against the proxy host and 404
 *   • passes Range requests through so seeking and segment fetches work
 *   • adds permissive CORS headers
 *
 * Node runtime (not Edge) so large media segments stream reliably.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Range,Origin,Accept,Content-Type,User-Agent,X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Content-Type,Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

/** Make a possibly-relative URI absolute against a base. */
function absolute(uri, base) {
  try {
    return new URL(uri, base).href;
  } catch {
    return uri;
  }
}

/**
 * Work out the public origin of this function so rewritten playlist URIs point
 * back at us. Vercel terminates TLS, so trust `x-forwarded-proto`; fall back to
 * the socket and finally to http (which is what `vercel dev` serves).
 */
function publicOrigin(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwarded || ((req.socket && req.socket.encrypted) ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function looksLikePlaylist(contentType, text) {
  if (contentType && /mpegurl|x-mpegURL/i.test(contentType)) return true;
  return typeof text === 'string' && text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U');
}

/**
 * Rewrite every URI in a playlist so it points back at this proxy.
 * Handles bare URI lines and URI="..." attributes (#EXT-X-KEY, #EXT-X-MAP,
 * #EXT-X-MEDIA).
 */
function rewritePlaylist(text, baseUrl, proxyBase) {
  const wrap = (uri) => `${proxyBase}?url=${encodeURIComponent(absolute(uri, baseUrl))}`;

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        if (!/URI="/i.test(line)) return line;
        return line.replace(/URI="([^"]*)"/gi, (_m, uri) => `URI="${wrap(uri)}"`);
      }
      return wrap(trimmed);
    })
    .join('\n');
}

export default async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  // Capability probe + human-readable usage. The app calls this bare endpoint to
  // detect the proxy; the JSON shape makes a static host's HTML fallback fail
  // clearly rather than being mistaken for a working proxy.
  const requested = new URL(req.url, publicOrigin(req));
  const target = requested.searchParams.get('url');

  if (!target) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      service: 'mmtv-proxy',
      ok: true,
      usage: `${requested.origin}/api/proxy?url=<absolute stream url>`,
    }));
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    res.writeHead(400, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad "url" parameter');
    return;
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    res.writeHead(400, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Only http(s) targets are allowed');
    return;
  }

  // Present ourselves the way the broadcaster's CDN expects.
  const upstreamHeaders = {
    'User-Agent': BROWSER_UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: `${targetUrl.origin}/`,
  };
  if (req.headers.range) upstreamHeaders.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(targetUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: 'follow',
    });
  } catch (error) {
    res.writeHead(502, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Upstream fetch failed: ${error && error.message}`);
    return;
  }

  const contentType = upstream.headers.get('content-type') || '';
  const proxyBase = `${requested.origin}${requested.pathname}`;
  const out = {
    ...CORS,
    'Content-Type': contentType || 'application/octet-stream',
    'Cache-Control': 'no-store',
  };
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) out['Content-Range'] = contentRange;
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (acceptRanges) out['Accept-Ranges'] = acceptRanges;

  const isPlaylist = /mpegurl|\.m3u8/i.test(contentType) ||
    /\.m3u8(\?|$)/i.test(targetUrl.pathname + targetUrl.search);

  // Playlists are small text files — read, rewrite, return.
  if (isPlaylist) {
    const text = await upstream.text();
    if (looksLikePlaylist(contentType, text)) {
      const body = rewritePlaylist(text, upstream.url || targetUrl.href, proxyBase);
      res.writeHead(upstream.status, {
        ...out,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    res.writeHead(upstream.status, out);
    res.end(text);
    return;
  }

  // Everything else (segments, keys, images) streams straight through.
  res.writeHead(upstream.status, out);
  if (!upstream.body) {
    res.end();
    return;
  }

  const { Readable } = await import('node:stream');
  const body = Readable.fromWeb(upstream.body);

  // Players abandon segment requests constantly (seeking, quality switching,
  // closing the player). Tear down cleanly instead of throwing.
  const cleanup = () => {
    body.destroy();
    if (!res.writableEnded) res.end();
  };
  body.on('error', cleanup);
  res.on('close', cleanup);
  body.pipe(res);
}

export const config = {
  // Media segments are large; give the function room to stream them.
  maxDuration: 60,
};
