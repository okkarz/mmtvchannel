// Tiny local build helper: serves the repo and accepts canvas-normalised logos.
//   node tools/normalize-server.mjs
//   → app      http://localhost:8099/
//   → tool     http://localhost:8099/tools/normalize.html
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8099;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name') || 'out.png';
    const safe = path.basename(name);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const b64 = body.replace(/^data:image\/\w+;base64,/, '');
      const dest = path.join(ROOT, 'assets', 'logos', safe);
      fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
      console.log(`saved ${dest} (${Buffer.from(b64, 'base64').length} bytes)`);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`normalize server on http://localhost:${PORT}`));
