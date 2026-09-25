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
| `ygncdn.com` | media segments return `403` **if a foreign `Referer` is sent** — with no `Referer` at all they serve fine | **no** (see below) |
| `rtmptv.fortunebb.net:8282` | **plain HTTP only** (no TLS on 8282 or 443), no CORS → blocked as mixed content | **yes** |
| `mrtvott.com` | CORS `*`, plays directly (8 MRTV-family channels) | no |
| `live.pyoneplay.com` | CORS `*`, any referrer accepted (MRTV-4, Channel 7) | no |
| `live-stream.dvb.no` | sends `Access-Control-Allow-Origin: *` | no |
| `pplive.comquas.com` | sends `Access-Control-Allow-Origin: *` | no (the stream itself is currently `404`) |

> If you re-probe these hosts, use a **GET with an `Origin` header**. `mrtvott.com`
> answers a `HEAD` request *without* `Access-Control-Allow-Origin` but returns it
> on `GET`, so `curl -I` makes a working stream look proxy-only.
> `node tools/cors-probe.mjs` does this properly for every channel, and
> `PROBE_NO_REFERER=1` reproduces the browser's post-fix behaviour.

### The `Referer` trap (found 2026-09-25)

**CORS was never the main problem.** Only one channel has a CORS problem; two
others *looked* like one and were not.

`ygncdn.com` grades segment requests on the `Referer` header:

| `Referer` sent | Result |
|---|---|
| *(none)* | **200** |
| `https://ygncdn.com/` | **200** |
| any other origin (e.g. this app) | **403** |

A browser attaches this page's origin to every cross-origin request
automatically, so segments were being refused — while VLC, which sends no
`Referer` by default, played the very same URL happily. The app now ships
`Referrer-Policy: no-referrer` (`index.html` meta tag + the header in
`vercel.json` — the header wins, so **change both or neither**), and the two
Mahar channels play directly. Verified with the proxy switched off entirely: the
playlist, all three renditions and their segments return `200`.

The same probe also showed the failure modes are not interchangeable:

- **`mrtvott.com` blocks requests without a browser-like `User-Agent`** — a
  `curl/8.x` UA gets `403` on every path while a Chrome UA gets `200`. It also
  redirects to a token-signed URL (`…/cb9e52bc…---/cache/…`), so always follow
  redirects when probing it.
- **`maharbawdi` returns `404`** — the stream is gone, not blocked.
- **Fortune TV is the one genuine CORS case**: it sends no
  `Access-Control-Allow-Origin` at all, so only the proxy (or VLC) can play it.

Net effect: **the proxy is now needed for exactly one channel** instead of three,
which keeps roughly 4 Mbps of live video off the Vercel function.

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

### No proxy? Hand the channel to VLC

The proxy is the fix for blocked channels, but it is not the only way to watch
them. **VLC is not a browser**, so the rules that stop a web page — CORS, a
`Referer` allow-list, plain HTTP on a secure origin — do not apply to it. When a
channel fails, the error panel offers **Open in VLC**, which hands the
broadcaster's own URL to the player.

That makes it the one path that needs no proxy at all, and the only way to play
the plain-HTTP channels when no proxy is deployed.

| Platform | What the button does |
|---|---|
| Android | `intent://` naming `org.videolan.vlc`, so VLC opens directly |
| iOS / iPadOS | `vlc-x-callback://x-callback-url/stream?url=…` (VLC 2.4+) |
| Desktop | `vlc://` — VLC's registered protocol handler |

No API reports whether a player is installed, so the handoff is confirmed by
absence: if the page is still visible and focused ~2 s later, nothing took over
and the stream URL is **copied to the clipboard** instead, with a reminder to
paste it into *VLC → Open Network Stream*. That paste route is also the only one
available on a TV, where there is no external player to hand off to.

The broadcaster's raw URL is what gets handed over — never the proxy URL, which
is only meaningful inside the page.

> **Worth verifying per device.** The `vlc://` desktop handler cannot be tested
> from a browser, and URL parsing rewrites `vlc://https://…` to `vlc://https//…`
> (losing the inner scheme). If desktop handoff does not open VLC, the copy
> fallback still fires — paste the URL into VLC manually.

---

## Channels

15 channels across 5 categories. Every stream was probed again on 2026-09-25.

| Channel | Category | Source | Proxy | Logo |
|---|---|---|---|---|
| MRTV HD | General | mrtvott.com | no | Wikimedia Commons |
| MRTV News | News | mrtvott.com | no | Wikimedia Commons |
| MRTV Sports | Sports | mrtvott.com | no | broadcaster |
| MRTV Farmer | Knowledge | mrtvott.com | no | broadcaster |
| MRTV NRC | General | mrtvott.com | no | broadcaster |
| MRTV Entertainment | Entertainment | mrtvott.com | no | en.wikipedia.org |
| Hluttaw | News | mrtvott.com | no | shanstate.hluttaw.mm |
| MITV | News | mrtvott.com | no | en.wikipedia.org |
| Mahar HD | General | ygncdn.com | no | Wikimedia Commons |
| Mahar Esports | Sports | ygncdn.com | no | broadcaster |
| Maharbawdi | Entertainment | pplive.comquas.com | no | YouTube channel |
| DVB TV | News | live-stream.dvb.no | no | dvb.no |
| MRTV-4 | Entertainment | live.pyoneplay.com | no | Wikimedia Commons |
| Fortune TV | Entertainment | rtmptv.fortunebb.net | **yes** | broadcaster |
| Channel 7 | Entertainment | live.pyoneplay.com | no | en.wikipedia.org |

**Fortune TV is the only channel that needs the proxy** — it is the one host that
sends no `Access-Control-Allow-Origin`. Everything else plays direct, and
`Maharbawdi` is listed but its stream currently returns `404`. Each row's flag
lives in `needsProxy` in `data/channels.js`; the recovery ladder falls back to the
proxy if a "no" ever starts failing.

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
  cors-probe.mjs            probes every channel as a browser would (CORS/Referer)
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
use native HLS instead. A watchdog restarts the loader if `currentTime` stops
advancing for ~10 s, and a 20 s start-up timer catches streams that hand over a
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
in **seconds** (`liveSyncDuration: 15`), which normalises it, and DVB starts
three times closer to live as a result. Note that `hls.js` refuses to mix the
count-based and time-based families, so only one may be set.

On a live stream the forward buffer can never be deeper than the distance to the
live edge, so **`liveSyncDuration` is the buffer** — `maxBufferLength` is only a
ceiling, and it matters after a stall, when latency has grown and there is room
to refill. Sitting 15 s back costs a few seconds of extra delay (VLC sits further
back) and is what keeps playback from running dry.

Other changes for slow or unstable connections:

- **`abrMaxWithRealBitrate`** — see the warning below.
- **Gentle live-edge catch-up** (`maxLiveSyncPlaybackRate: 1.1`) — `hls.js`
  raises `playbackRate` whenever latency exceeds the target, which on a live
  stream drains the buffer *and* demands more bandwidth to refill it, so a link
  that only just sustains the stream never settles. VLC never varies its rate;
  this keeps the correction to 10% instead of 50%.
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

### Unobtrusive playback chrome

While a stream is playing, the player chrome — channel logo, name, LIVE badge,
channel-list button, transport controls and volume — **hides itself after about
3.5 seconds** so nothing sits over the picture. It comes back on any interaction:

- moving the mouse, or any pointer/touch activity
- pressing any key, including a remote's arrow buttons
- tapping or clicking the picture

Tapping the video toggles the chrome rather than pausing, so the first tap on a
phone always brings the controls back instead of stopping playback.

The chrome deliberately **stays visible** when it would be unhelpful to hide it:
while a stream is paused, while connecting or buffering, while a message is
showing, and while the channel list, settings or help panel is open. It also
never leaves keyboard focus on a control that has just become invisible, so the
D-pad highlight can't end up on something the viewer cannot see.

### When something goes wrong

Failures surface as a panel over the video offering:

| Action | What it does |
|---|---|
| **Retry** | Reloads the current channel (the primary action) |
| **Try via proxy** | Shown only when a proxy is available and not already in use |
| **Next channel** | Moves to the next live channel |
| **Dismiss** | Clears the message and returns to watching |

There is deliberately **one** dismiss control, not two — an earlier version also
had a ✕ in the corner, but it called the same function, so it was removed.

Back/Escape also dismisses the panel rather than throwing you out of the channel;
a second Back then returns to the grid. While the panel is up, D-pad navigation
is confined to it, so the highlight can never land on a control hidden behind it.
Dismissing lets the watchdog resume, so it will reconnect on its own if the
picture really has stalled.

**Proxy fallback.** Channels marked `needsProxy` go through the proxy immediately.
Everything else tries the broadcaster directly and recovers through the ladder
described above — restarting the loader, stepping down a rendition, then trying
the proxy, before finally reporting a problem.

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
