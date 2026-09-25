/**
 * Channel catalogue.
 *
 * Every entry was probed on 2026-09-18:
 *   status  : HTTP result of the master playlist
 *   needsProxy: true when the host blocks direct browser playback — no CORS
 *               headers, a Referer allow-list, or plain HTTP (mixed content).
 *               Verified behaviour:
 *                 mrtvott.com          → CORS * on GET, plays directly → no proxy
 *                 ygncdn.com           → segments 403 unless the Referer is
 *                                        its own origin        → proxy
 *                 rtmptv.fortunebb.net → plain HTTP + no CORS → proxy
 *                 live.pyoneplay.com   → CORS * and accepts any Referer → direct
 *                 live-stream.dvb.no   → CORS * and accepts any Referer → direct
 *                 pplive.comquas.com   → CORS * and accepts any Referer → direct
 *
 * NOTE: test CORS with a GET carrying an `Origin` header. mrtvott.com answers a
 * HEAD request without Access-Control-Allow-Origin but returns it on GET, so
 * probing with `curl -I` wrongly marks a working stream as proxy-only.
 *
 * Verified formats — all are HLS (m3u8) and play in hls.js.
 * `token` channels mint a short-lived signed URL and cannot be hard-coded.
 */
window.CHANNELS = [
  {
    id: 'mrtv-hd',
    name: 'MRTV HD',
    short: 'MRTV',
    full: 'Myanmar Radio and Television',
    category: 'General',
    language: 'Burmese',
    logo: 'assets/logos/mrtv.png',
    url: 'https://mrtvott.com/cache/MRTV-HD/master.m3u8',
    needsProxy: false,
    quality: 'HD',
    color: '#F2C230',
    featured: true,
  },
  {
    id: 'mrtv-news',
    name: 'MRTV News',
    short: 'News',
    full: 'MRTV News Channel',
    category: 'News',
    language: 'Burmese',
    logo: 'assets/logos/mrtvnews.png',
    url: 'https://mrtvott.com/cache/MRTV-NEWS-HD/master.m3u8',
    needsProxy: false,
    quality: 'HD',
    color: '#2563EB',
  },
  {
    id: 'mrtv-sports',
    name: 'MRTV Sports',
    short: 'Sports',
    full: 'MRTV Sports',
    category: 'Sports',
    language: 'Burmese',
    logo: 'assets/logos/mrtv-sports.png',
    url: 'https://mrtvott.com/cache/MRTV-SPORT/master.m3u8',
    needsProxy: false,
    quality: 'SD',
    color: '#16A34A',
  },
  {
    id: 'mrtv-farmer',
    name: 'MRTV Farmer',
    short: 'Farmer',
    full: 'MRTV Farmer / Agriculture Channel',
    category: 'Knowledge',
    language: 'Burmese',
    logo: 'assets/logos/mrtv-farmer.png',
    url: 'https://mrtvott.com/cache/MRTV-FARMER/master.m3u8',
    needsProxy: false,
    quality: 'SD',
    color: '#65A30D',
  },
  {
    id: 'mrtv-nrc',
    name: 'MRTV NRC',
    short: 'NRC',
    full: 'MRTV National Races Channel',
    category: 'General',
    language: 'Burmese',
    logo: 'assets/logos/mrtv-nrc.png',
    url: 'https://mrtvott.com/cache/MRTV-NRC-HD/master.m3u8',
    needsProxy: false,
    quality: 'HD',
    color: '#9333EA',
  },
  {
    id: 'mrtv-ent',
    name: 'MRTV Entertainment',
    short: 'ME',
    full: 'MRTV Entertainment Channel',
    category: 'Entertainment',
    language: 'Burmese',
    logo: 'assets/logos/mrtv-ent.png',
    url: 'https://mrtvott.com/cache/MRTV-Ent-HD/master.m3u8',
    needsProxy: false,
    quality: 'HD',
    color: '#DB2777',
  },
  {
    id: 'hluttaw',
    name: 'Hluttaw',
    short: 'Hluttaw',
    full: 'Pyidaungsu Hluttaw Channel',
    category: 'News',
    language: 'Burmese',
    logo: 'assets/logos/hluttaw.png',
    url: 'https://mrtvott.com/cache/MRTV-HLUTTAW/master.m3u8',
    needsProxy: false,
    quality: 'SD',
    color: '#DC2626',
  },
  {
    id: 'mitv',
    name: 'MITV',
    short: 'MITV',
    full: 'Myanmar International TV',
    category: 'News',
    language: 'English',
    logo: 'assets/logos/mitv.png',
    url: 'https://mrtvott.com/cache/MITV/master.m3u8',
    needsProxy: false,
    quality: 'SD',
    color: '#0891B2',
  },
  {
    id: 'mahar-hd',
    name: 'Mahar HD',
    short: 'Mahar',
    full: 'Mahar TV',
    category: 'General',
    language: 'Burmese',
    logo: 'assets/logos/mahar.png',
    url: 'https://ygncdn.com/live/mahar/playlist.m3u8',
    // ygncdn 403s a segment that arrives with a *foreign* Referer, but serves it
    // happily when no Referer is sent at all. The app ships
    // `Referrer-Policy: no-referrer`, so the browser stays silent and these play
    // direct — which keeps ~4 Mbps of live video off the Vercel proxy. The
    // recovery ladder still falls back to the proxy if a host ever 403s anyway.
    needsProxy: false,
    quality: 'HD',
    color: '#06B6D4',
  },
  {
    id: 'mahar-esports',
    name: 'Mahar Esports',
    short: 'Esports',
    full: 'Mahar Esports HD',
    category: 'Sports',
    language: 'Burmese',
    logo: 'assets/logos/mahar-esports.png',
    url: 'https://ygncdn.com/live/maharesports/playlist.m3u8',
    needsProxy: false, // see mahar-hd: a foreign Referer is what triggered the 403
    quality: 'HD',
    color: '#0EA5E9',
  },
  {
    id: 'maharbawdi',
    name: 'Maharbawdi',
    short: 'MBD',
    full: 'Maharbawdi TV',
    category: 'Entertainment',
    language: 'Burmese',
    logo: 'assets/logos/maharbawdi.png',
    url: 'https://pplive.comquas.com:5443/LiveApp/streams/rHEBIW7pjQLU1677679374164.m3u8',
    needsProxy: false,
    quality: 'HD',
    color: '#7C3AED',
  },
  {
    id: 'dvb',
    name: 'DVB TV',
    short: 'DVB',
    full: 'Democratic Voice of Burma',
    category: 'News',
    language: 'Burmese',
    logo: 'assets/logos/dvb.png',
    url: 'https://live-stream.dvb.no/hls/stream.m3u8',
    needsProxy: false,
    quality: 'SD',
    color: '#1D4ED8',
    featured: true,
  },
  {
    id: 'mrtv4',
    name: 'MRTV-4',
    short: 'MRTV-4',
    full: 'MRTV-4 Entertainment',
    category: 'Entertainment',
    language: 'Burmese',
    logo: 'assets/logos/mrtv4.png',
    url: 'https://live.pyoneplay.com/live/01m2sn12yc6v2enx392qj2ekqt/index.m3u8',
    needsProxy: false,
    quality: 'HD',
    color: '#0EA5E9',
    featured: true,
  },
  {
    id: 'fortune',
    name: 'Fortune TV',
    short: 'Fortune',
    full: 'Fortune TV Myanmar',
    category: 'Entertainment',
    language: 'Burmese',
    logo: 'assets/logos/fortune.png',
    // Verified 2026-09-18: master playlist 200 (1080p + 480p variants), media
    // segments return valid MPEG-TS. The host serves **plain HTTP only** — port
    // 8282 and 443 both refuse TLS — so on an HTTPS page the browser blocks it as
    // mixed content and there are no CORS headers either. The proxy is required.
    url: 'http://rtmptv.fortunebb.net:8282/hls/fortunetv/vmix.m3u8',
    needsProxy: true,
    quality: 'SD',
    color: '#F59E0B',
  },
  {
    id: 'channel7',
    name: 'Channel 7',
    short: 'CH7',
    full: 'Channel 7 HD',
    category: 'Entertainment',
    language: 'Burmese',
    logo: 'assets/logos/channel7.png',
    url: 'https://live.pyoneplay.com/live/01m2sr3kyn6bztz3xk02w3t7pn/index.m3u8',
    needsProxy: false,
    quality: 'HD',
    color: '#E11D48',
  },
];

/** Categories in display order. */
window.CATEGORIES = ['All', 'General', 'News', 'Sports', 'Entertainment', 'Knowledge'];
