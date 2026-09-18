/**
 * Local HTTPS server for testing the app the way it will actually be deployed.
 *
 *   node tools/https-server.mjs        # https://localhost:8443
 *
 * Useful for verifying behaviour that only appears on a secure origin, e.g.
 * mixed-content blocking of plain-HTTP streams like Fortune TV, and service
 * worker / PWA install behaviour.
 *
 * Uses a self-signed cert in tools/certs/ (git-ignored — generate your own first):
 *
 *   mkdir -p tools/certs && cd tools/certs
 *   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 \
 *     -nodes -subj "/CN=localhost" \
 *     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
 */
import http2 from 'node:http2';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT || 8443);
const CERT = path.join(import.meta.dirname, 'certs');

const KEY_FILE = path.join(CERT, 'key.pem');
const CRT_FILE = path.join(CERT, 'cert.pem');

if (!fs.existsSync(KEY_FILE) || !fs.existsSync(CRT_FILE)) {
  console.error('Missing tools/certs/{key,cert}.pem — generate a self-signed pair with:\n');
  console.error('  mkdir -p tools/certs && cd tools/certs');
  console.error('  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 \\');
  console.error('    -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

const server = http2.createSecureServer({
  key: fs.readFileSync(KEY_FILE),
  cert: fs.readFileSync(CRT_FILE),
  allowHTTP1: true,
});

server.on('request', (req, res) => {
  const url = new URL(req.url, `https://localhost:${PORT}`);
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

server.on('error', (error) => {
  console.error('[https] server error:', error.message);
});

server.listen(PORT, () => {
  console.log(`HTTPS dev server on https://localhost:${PORT}`);
  console.log('(self-signed cert — accept the browser warning once)');
});
