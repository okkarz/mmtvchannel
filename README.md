# Myanmar TV 📺

A fast, installable **PWA** for watching Myanmar live TV channels. Designed
mobile-first, but built just as much for the couch: the whole interface is
drivable with a TV remote's D-pad.

No build step, no framework, no npm install. Plain HTML, CSS and JavaScript with
a locally vendored `hls.js`, so it works offline once installed.

```
┌─ Home ─────────────────────────────┐   ┌─ Player ──────────────────────────┐
│  search · category chips · grid    │ → │  full-bleed HLS video + overlay   │
│  "continue watching" rail          │ ← │  channel drawer · quality · PiP   │
└────────────────────────────────────┘   └───────────────────────────────────┘
```

---

## Quick start

```bash
# any static server works
python3 -m http.server 8080
# → http://localhost:8080
```

> Open it over `http://localhost` (not `file://`) — service workers and most
> stream hosts require a real origin.

---

## ⚠️ Read this first: the CORS proxy

**Some channels will not play until you set up the proxy.** This is not a bug in
the app — several Myanmar broadcasters actively block browser playback:

| Host | What it does | Needs proxy |
|---|---|---|
| `mrtvott.com` | returns `403` to browser requests | **yes** |
| `ygncdn.com` | media segments return `403` unless the `Referer` is ygncdn's own origin | **yes** |
| `rtmptv.fortunebb.net:8282` | **plain HTTP only** (no TLS on 8282 or 443) + no CORS → blocked as mixed content | **yes** |
| `live.pyoneplay.com` | CORS `*`, any referrer accepted (MRTV-4, Channel 7) | no |
| `live-stream.dvb.no` | sends `Access-Control-Allow-Origin: *` | no |
| `pplive.comquas.com` | sends `Access-Control-Allow-Origin: *` | no |

A web page cannot set its own `Referer` or bypass mixed-content rules, so the fix
is a one-hop server-side proxy.

Plain-HTTP channels are detected *before* a request is made, so on an HTTPS
deployment you get an accurate "this channel needs the proxy" explanation rather
than an opaque network error.

### On Vercel: nothing to do ✅

**Deploying to Vercel sets the proxy up automatically.** [`api/proxy.js`](api/proxy.js)
is a serverless function served from the same origin, and the app detects it on
startup. Channels that need it are routed through it; the rest still connect
directly. There is no account, key or configuration involved.

The catch is usage: proxied streams pass through your Vercel function, so heavy
viewing of the blocked channels counts against your plan's bandwidth. For a
personal setup the free tier is usually plenty.

### Elsewhere: deploy the Cloudflare Worker

On any other host (GitHub Pages, Netlify, a static server) there is no server to
run the proxy, so deploy it separately — free, ~1 minute:

1. Go to <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Worker**
2. Paste the contents of [`proxy/worker.js`](proxy/worker.js) → **Deploy**
3. In the app: **Settings → CORS proxy URL** → paste your `https://….workers.dev` URL

Either way, with *"Automatically use the proxy for channels that need it"* on
(default) only the channels that require it are routed through the proxy. A URL
typed into Settings always takes priority over the built-in one.

Both proxies **rewrite HLS playlists** so that every nested URI — segments,
encryption keys, `EXT-X-MAP` init files, alternate renditions — is proxied too.
Without that rewriting, relative URIs would resolve against the proxy host and 404.

### Try the proxy locally first

```bash
node tools/local-proxy.mjs          # http://localhost:8098
```
Then set the proxy URL in Settings to `http://localhost:8098`.

Or run the whole thing exactly as Vercel would, including the built-in function:

```bash
vercel dev                          # http://localhost:3000
```

---

## Channels

15 channels across 5 categories. Every stream was probed on 2026-09-18.

| Channel | Category | Source | Proxy | Logo |
|---|---|---|---|---|
| MRTV HD | General | mrtvott.com | yes | Wikimedia Commons |
| MRTV News | News | mrtvott.com | yes | Wikimedia Commons |
| MRTV Sports | Sports | mrtvott.com | yes | broadcaster |
| MRTV Farmer | Knowledge | mrtvott.com | yes | broadcaster |
| MRTV NRC | General | mrtvott.com | yes | broadcaster |
| MRTV Entertainment | Entertainment | mrtvott.com | yes | en.wikipedia.org |
| Hluttaw | News | mrtvott.com | yes | shanstate.hluttaw.mm |
| MITV | News | mrtvott.com | yes | en.wikipedia.org |
| Mahar HD | General | ygncdn.com | yes | Wikimedia Commons |
| Mahar Esports | Sports | ygncdn.com | yes | broadcaster |
| Maharbawdi | Entertainment | pplive.comquas.com | no | YouTube channel |
| DVB TV | News | live-stream.dvb.no | no | dvb.no |
| MRTV-4 | Entertainment | live.pyoneplay.com | no | Wikimedia Commons |
| Fortune TV | Entertainment | rtmptv.fortunebb.net | yes | broadcaster |
| Channel 7 | Entertainment | live.pyoneplay.com | no | en.wikipedia.org |

Every channel now ships a real logo — none rely on the coloured monogram fallback
(which remains in place if a logo ever fails to load).

### Adding or changing channels

Edit [`data/channels.js`](data/channels.js):

```js
{
  id: 'my-channel',            // used in the URL: #/watch/my-channel
  name: 'My Channel',          // shown on the card
  short: 'MC',
  full: 'My Channel Entertainment',
  category: 'Entertainment',   // must exist in window.CATEGORIES
  language: 'Burmese',
  logo: 'assets/logos/my.png', // or null → monogram tile
  url: 'https://example.com/live/master.m3u8',
  needsProxy: false,
  quality: 'HD',
  color: '#7C3AED',            // monogram colours + accents
}
```

---

## TV & remote control

The grid uses **spatial navigation**: an arrow press always lands on the nearest
tile in that direction, preferring elements that overlap on the other axis. Focus
rings are deliberately large, and Home/Back always returns you to where you were.

| Remote / key | Action |
|---|---|
| ▲ ▼ ◀ ▶ | move the highlight |
| OK / Enter | open the highlighted channel |
| Back / Esc | back to the grid (closes overlays first) |
| Space | play / pause |
| M · F · C · Q | mute · fullscreen · channel list · quality |
| R | rotate the screen (phones) |
| / · ? | search · shortcuts |

Back-key codes from webOS (`461`), Tizen (`10009`) and Orsay (`10033`) remotes are
handled, alongside `Backspace` and `Escape`.

Layout adapts from 2 columns on a phone to 6 on a 1080p TV, with larger type,
bigger hit targets and overscan-safe padding beyond 1500 px.

### Rotating the screen on a phone

The player has a **rotate button** (shown only on handhelds, between the
picture-in-picture and fullscreen controls) that forces landscape, so you can
watch widescreen video without holding the phone sideways:

- **Android / Chromium** — locks the real orientation via the Screen Orientation
  API. Because browsers only permit this while fullscreen, the button enters
  fullscreen first. Pressing it again locks back to portrait.
- **iOS Safari** — has no orientation API, so the button opens Safari's native
  fullscreen video player instead, which handles rotation itself.
- **Anything else** — explains that the device has to be turned.

Leaving the player releases any orientation lock.

---

## Install as an app

The app ships a manifest and a service worker, so it can be installed to the home
screen / desktop and launched fullscreen. The shell (HTML, CSS, JS, `hls.js`,
logos, font) is precached; **live streams are never cached** — the service worker
explicitly skips `.m3u8`, `.ts`, `.m4s`, range requests and proxied traffic.

### Deploying

**Vercel (recommended — the proxy comes with it):**

```bash
vercel --prod
```

No build step and no configuration: the app is served as static files from the
repo root, and `api/proxy.js` deploys automatically as a serverless function.
The app finds it and starts using it, so even the blocked channels work.

**Any other static host** — the whole app is the repo root:

```bash
# Netlify
netlify deploy --prod --dir .

# GitHub Pages: push, then Settings → Pages → branch main, folder / (root)
```

On these hosts there is no serverless function, so the blocked channels need the
separate Cloudflare Worker (see the proxy section above) — set its URL in
**Settings**. Preferences are per-device, stored in `localStorage`.

---

## Project layout

```
index.html                  app shell (home + player views, settings, help)
styles.css                  design tokens, layout, TV/D-pad focus styling
app.js                      routing, player, spatial navigation, prefs, PWA
data/channels.js            the channel catalogue
manifest.webmanifest        PWA manifest + shortcuts
sw.js                       app-shell cache (never caches video)
vendor/hls.min.js           hls.js, vendored for offline use
assets/
  fonts/inter-variable.woff2
  icons/                    SVG source + 192/512/maskable PNGs
  logos/                    channel logos (trimmed + resized)
api/proxy.js                serverless CORS proxy (auto-used on Vercel)
vercel.json                 headers + routing for the Vercel deploy
proxy/worker.js             the same proxy as a Cloudflare Worker
tools/
  local-proxy.mjs           same proxy, runnable locally
  https-server.mjs          HTTPS dev server, for testing secure-origin behaviour
  certs/                    self-signed dev cert (git-ignored — generate your own)
  normalize.html            logo trim/resize helper (canvas based)
  normalize-server.mjs      dev server for the helper
  diagnostics.html          measures startup time and true rendition bitrates
  originals/                untouched logo downloads used as normalizer input
```

---

## How it works

**Playback.** `hls.js` tuned for live television rather than VOD. Safari and iOS
use native HLS instead. A watchdog reloads the stream if `currentTime` stops
advancing for ~6 s, and a 20 s start-up timer catches streams that hand over a
playlist but never deliver a frame — so you get a real error with a Retry button
instead of an endless spinner.

### Tuning for live streams

Startup time on a live channel is dominated by how much video has to download
before playback can begin: *(segments behind the live edge) × (segment size)*.
Those numbers vary enormously between these broadcasters:

| Stream | Segment length | Segment size |
|---|---|---|
| Mahar | 4 s | 0.5–1.8 MB |
| Fortune TV | 6.5 s | 2.3 MB |
| MRTV-4, Channel 7 | 6 s | 0.5 MB |
| DVB | **10–18 s** | 0.8 MB |

A count-based live target of 3 fragments therefore meant very different delays
per channel — 12 s of video on Mahar but **31 s on DVB**. The target is now set
in **seconds** (`liveSyncDuration: 10`), which normalises it, and DVB starts
three times closer to live as a result. Note that `hls.js` refuses to mix the
count-based and time-based families, so only one may be set.

Other changes for slow or unstable connections:

- **`abrMaxWithRealBitrate`** — see the warning below.
- **Smaller buffer** (`maxBufferLength: 16`) — less to refill after a dropout.
- **ABR biased to stability** — drops a rendition sooner when throughput falls,
  climbs back more cautiously, so it stops oscillating between tiers.
- **Fast retries** (300 ms) — a dropped packet recovers long before it is visible.
- **A recovery ladder** for fatal network errors, cheapest first: restart the
  loader (keeps the buffered video) → step down a rendition → switch to the
  proxy → full restart. Previously every fatal error meant a full teardown.

Run `tools/diagnostics.html` to measure this on your own connection; it reports
per-channel startup time and compares advertised bitrates against what the
streams actually serve.

### ⚠️ Broadcasters misreport their qualities

**ABR is only as good as the bitrates a broadcaster declares — and some lie.**
Fortune TV's master playlist advertises:

| Playlist claims | Actually serves |
|---|---|
| `1080p @ 2 Mbps` | **1280×720 @ 3.00 Mbps** |
| `480p @ 1 Mbps` | **1280×720 @ 2.99 Mbps** |

Both renditions are the same 720p encode at the same bitrate, and both are 50%
*higher* than declared. Left alone, `hls.js` believes 2 Mbps covers that level
and stalls on connections that cannot hold 3 Mbps, while "switching quality"
changes nothing. `abrMaxWithRealBitrate: true` makes the ABR use measured
throughput instead of the claim, which is what fixes it.

Mahar, by contrast, is honest — 1080p/720p/360p really do differ ~4× — so
quality switching genuinely helps there.

**Proxy fallback.** Channels marked `needsProxy` go through the proxy immediately.
For everything else the app tries the broadcaster directly, and on a fatal network
error automatically retries once through the proxy before showing an error.

**Focus.** Focus is moved with `element.focus()`, so screen readers and native
button activation keep working. Arrow keys inside a text field still move the
caret — horizontal arrows only escape once the caret reaches the text edge, while
vertical arrows always leave the field (there is no other way out on a remote).

**Accessibility.** Full keyboard operation, a skip link, `aria-label`s on all
icon-only buttons, an `aria-live` status region, visible focus rings, and support
for `prefers-reduced-motion` and `prefers-contrast: more`.

---

## Known limitations

- **Logos are hand-curated** and several came from small, watermarked or
  low-resolution sources (the ME mark carries a third-party watermark). Replace
  them with clean brand assets when available and re-run the normalizer.
- **5 Plus** and other token-gated channels from `myanmartvchannels.com` cannot be
  included: their URLs carry a signed token that expires after 10 minutes, and the
  site sits behind a Cloudflare bot challenge.
- Streams are third-party links that change or go down without notice. If a channel
  stops working, re-probe its URL and update `data/channels.js`.
- Free proxies can be slow for HD. The included Cloudflare Worker adds one hop and
  is usually fine, but it is not a CDN.

---

## Credits

Channel logos are the property of their respective broadcasters and are used for
identification only: MRTV, MRTV News, MRTV-4 and Mahar via Wikimedia Commons;
MRTV Entertainment (ME), MITV, Channel 7 and the MRTV Sports / Farmer / NRC marks
via the broadcasters' own published artwork; Hluttaw via shanstate.hluttaw.mm;
DVB via dvb.no; Fortune via fortunebb.net; Maharbawdi via its YouTube channel.
Typeface is
[Inter](https://rsms.me/inter/) (SIL Open Font License). Video playback by
[hls.js](https://github.com/video-dev/hls.js) (Apache-2.0).
