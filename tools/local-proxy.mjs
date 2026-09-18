/**
 * Local development proxy — same behaviour as proxy/worker.js, but runnable on
 * your machine so you can test proxied playback without deploying anything.
 *
 *   node tools/local-proxy.mjs          # listens on http://localhost:8098
 *
 * Then in the app: Settings → CORS proxy URL → http://localhost:8098
 */
import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT || 8098);
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

const absolute = (uri, base) => { try { return new URL(uri, base).href; } catch { return uri; } };

const looksLikePlaylist = (contentType, text) =>
  /mpegurl|x-mpegURL/i.test(contentType || '') ||
  (typeof text === 'string' && text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U'));

function rewritePlaylist(text, baseUrl, proxyBase) {
  const wrap = (uri) => `${proxyBase}?url=${encodeURIComponent(absolute(uri, baseUrl))}`;
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      if (!/URI="/i.test(line)) return line;
      return line.replace(/URI="([^"]*)"/gi, (_m, uri) => `URI="${wrap(uri)}"`);
    }
    return wrap(trimmed);
  }).join('\n');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const target = url.searchParams.get('url');
  if (!target) {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain' }, CORS));
    res.end(`Local Myanmar TV proxy.\nUsage: http://localhost:${PORT}/?url=<absolute stream url>\n`);
    return;
  }

  let targetUrl;
  try { targetUrl = new URL(target); } catch {
    res.writeHead(400, Object.assign({ 'Content-Type': 'text/plain' }, CORS));
    res.end('Bad url parameter');
    return;
  }

  const headers = {
    'User-Agent': BROWSER_UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: targetUrl.origin + '/',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  try {
    const upstream = await fetch(targetUrl.href, { headers, redirect: 'follow' });
    const contentType = upstream.headers.get('content-type') || '';
    const proxyBase = `http://localhost:${PORT}/`;

    const out = Object.assign({}, CORS, {
      'Content-Type': contentType || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    const cr = upstream.headers.get('content-range');
    if (cr) out['Content-Range'] = cr;
    const ar = upstream.headers.get('accept-ranges');
    if (ar) out['Accept-Ranges'] = ar;

    const isPlaylist = /mpegurl|\.m3u8/i.test(contentType) ||
      /\.m3u8(\?|$)/i.test(targetUrl.pathname + targetUrl.search);

    if (isPlaylist) {
      const text = await upstream.text();
      if (looksLikePlaylist(contentType, text)) {
        const body = rewritePlaylist(text, upstream.url || targetUrl.href, proxyBase);
        res.writeHead(upstream.status, Object.assign({}, out,
          { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(body) }));
        res.end(body);
        return;
      }
      res.writeHead(upstream.status, out);
      res.end(text);
      return;
    }

    res.writeHead(upstream.status, out);
    if (!upstream.body) { res.end(); return; }

    // Video players abandon segment requests constantly (seeking, switching
    // quality, closing the player). Tearing the socket down mid-stream makes
    // both the upstream body and the response emit 'error'; without handlers
    // that becomes an unhandled exception and kills the whole proxy.
    const body = Readable.fromWeb(upstream.body);
    const cleanup = () => {
      body.destroy();
      if (!res.writableEnded) res.end();
    };
    body.on('error', cleanup);
    res.on('close', cleanup);
    body.pipe(res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, Object.assign({ 'Content-Type': 'text/plain' }, CORS));
    res.end(`Upstream fetch failed: ${error.message}`);
  }
});

// Never let one bad request take the process down.
server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
process.on('uncaughtException', (error) => {
  console.error('[proxy] uncaught exception:', error.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[proxy] unhandled rejection:', reason && reason.message ? reason.message : reason);
});

server.listen(PORT, () => console.log(`local proxy on http://localhost:${PORT}`));
