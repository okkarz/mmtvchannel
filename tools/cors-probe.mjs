/**
 * Answer one question with data instead of folklore: for every channel, what
 * does a *browser* actually get back?
 *
 *   node tools/cors-probe.mjs
 *
 * A browser is the only thing that enforces CORS, so the request has to look
 * like a browser's: a GET carrying an `Origin` header. A HEAD often omits
 * `Access-Control-Allow-Origin` on hosts that send it fine on GET, which is how
 * working channels get mislabelled as "proxy-only" — see the README warning.
 *
 * For each channel it walks master playlist → variant → first segment, because
 * a host can be perfectly happy serving playlists and still block the media.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.PROBE_ORIGIN || 'https://mmtvchannel.vercel.app';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT = 12000;

/* channels.js assigns to `window`, so give it one. */
const source = readFileSync(join(here, '..', 'data', 'channels.js'), 'utf8');
const window = {};
new Function('window', source)(window);
const CHANNELS = window.CHANNELS || [];

const absolute = (uri, base) => {
  try { return new URL(uri, base).href; } catch { return uri; }
};

/**
 * GET a URL the way a browser would, and report what came back.
 *
 * `PROBE_NO_REFERER=1` omits the Referer header, which is how the app behaves
 * now that it ships `Referrer-Policy: no-referrer`. Worth testing both ways:
 * several hosts behave completely differently depending on this one header.
 */
async function probe(url) {
  const started = Date.now();
  const headers = { 'User-Agent': UA, Origin: ORIGIN, Accept: '*/*' };
  if (!process.env.PROBE_NO_REFERER) headers.Referer = ORIGIN + '/';
  try {
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const acao = res.headers.get('access-control-allow-origin');
    return {
      status: res.status,
      acao,
      type: res.headers.get('content-type') || '',
      ms: Date.now() - started,
      body: res.ok ? await res.text() : '',
      finalUrl: res.url,
    };
  } catch (error) {
    return {
      status: 0,
      acao: null,
      type: '',
      ms: Date.now() - started,
      body: '',
      error: error.name === 'TimeoutError' ? `timeout after ${TIMEOUT}ms` : error.message,
    };
  }
}

const firstUri = (body) =>
  body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));

// The FIRST media URI in a live playlist is the oldest segment, which may have
// already aged out of the sliding window — that returns 403/404 and looks like a
// block when the host is fine. Always grade the newest segment instead.
const lastUri = (body) => {
  const uris = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return uris[uris.length - 1];
};

const verdict = (r) => {
  if (r.status === 0) return 'UNREACHABLE';
  if (r.status >= 400) return `HTTP ${r.status}`;
  if (!r.acao) return 'CORS-BLOCKED';
  if (r.acao !== '*' && !r.acao.includes(ORIGIN)) return 'CORS-ORIGIN-MISMATCH';
  return 'ok';
};

console.log(`Probing ${CHANNELS.length} channels as a browser would (Origin: ${ORIGIN})`);
console.log(`Referer: ${process.env.PROBE_NO_REFERER ? 'NOT SENT (app default)' : ORIGIN + '/'}\n`);

const tallies = {};
for (const ch of CHANNELS) {
  const master = await probe(ch.url);

  // Walk one level down: the master playlist's first variant, then its a
  // segment. A host can serve playlists happily and still block the media.
  let variant = { verdict: '—', acao: '—', ms: 0 };
  let segment = { verdict: '—', acao: '—', ms: 0, bytes: 0 };
  if (master.status === 200) {
    const vUrl = firstUri(master.body);
    if (vUrl) {
      const v = await probe(absolute(vUrl, master.finalUrl || ch.url));
      variant = { verdict: verdict(v), acao: v.acao || '—', ms: v.ms };
      if (v.status === 200) {
        const sUrl = lastUri(v.body);
        if (sUrl) {
          const s = await probe(absolute(sUrl, v.finalUrl || ch.url));
          segment = { verdict: verdict(s), acao: s.acao || '—', ms: s.ms, bytes: s.body.length };
        }
      }
    }
  }

  const overall =
    master.status !== 200 ? verdict(master)
      : variant.verdict !== 'ok' ? variant.verdict
        : segment.verdict !== 'ok' ? segment.verdict
          : 'PLAYS DIRECT';

  tallies[overall] = (tallies[overall] || 0) + 1;

  const flag = ch.needsProxy ? 'needsProxy' : '         ';
  console.log(
    `${overall.padEnd(21)} ${ch.id.padEnd(15)} ${flag}` +
    `  master ${String(master.status).padEnd(4)} acao=${String(master.acao || '—').padEnd(28)}` +
    (master.error ? ` ${master.error}` : '')
  );
  if (master.status === 200) {
    console.log(
      `${' '.repeat(21)} ${''.padEnd(15)} ${' '.repeat(11)}` +
      `  variant ${variant.verdict.padEnd(21)} acao=${variant.acao.padEnd(28)}` +
      `  segment ${segment.verdict}${segment.bytes ? ` (${segment.bytes} B in ${segment.ms}ms)` : ''}`
    );
  }
}

console.log('\nSummary');
for (const [k, v] of Object.entries(tallies).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(2)}  ${k}`);
}
