/* ============================================================================
   Myanmar TV — application logic
   Vanilla ES2020, no build step. hls.js is vendored locally so the app keeps
   working offline once installed.
   ========================================================================= */
(() => {
  'use strict';

  /* ── Shorthands ─────────────────────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const CHANNELS = window.CHANNELS || [];
  const CATEGORIES = window.CATEGORIES || ['All'];
  const APP_VERSION = 'v1.1.0';

  const byId = (id) => CHANNELS.find((c) => c.id === id) || null;
  const liveChannels = () => CHANNELS.filter((c) => !c.offline);

  /* ── DOM ────────────────────────────────────────────────────────────────── */
  const dom = {
    body: document.body,
    search: $('#search'),
    searchClear: $('#searchClear'),
    installBtn: $('#installBtn'),
    helpBtn: $('#helpBtn'),
    settingsBtn: $('#settingsBtn'),

    viewHome: $('#viewHome'),
    viewPlayer: $('#viewPlayer'),
    resumeRail: $('#resumeRail'),
    resumeBtn: $('#resumeBtn'),
    resumeThumb: $('#resumeThumb'),
    resumeName: $('#resumeName'),
    filters: $('#filters'),
    grid: $('#channels'),
    gridTitle: $('#gridTitle'),
    gridCount: $('#gridCount'),
    emptyState: $('#emptyState'),
    emptyTerm: $('#emptyTerm'),

    stage: $('#stage'),
    video: $('#video'),
    backBtn: $('#backBtn'),
    playerPlate: $('#playerLogoWrap'),
    playerName: $('#playerName'),
    playerMeta: $('#playerMeta'),
    livePill: $('#livePill'),
    statusChip: $('#statusChip'),
    listBtn: $('#listBtn'),
    spinner: $('#spinner'),
    spinnerText: $('#spinnerText'),
    errbox: $('#errbox'),
    errTitle: $('#errTitle'),
    errMsg: $('#errMsg'),
    retryBtn: $('#retryBtn'),
    proxyBtn: $('#proxyBtn'),
    nextBtn: $('#nextBtn'),
    dismissBtn: $('#dismissBtn'),

    playBtn: $('#playBtn'),
    muteBtn: $('#muteBtn'),
    volume: $('#volume'),
    qualityBtn: $('#qualityBtn'),
    qualityLabel: $('#qualityLabel'),
    pipBtn: $('#pipBtn'),
    fsBtn: $('#fsBtn'),
    rotateBtn: $('#rotateBtn'),

    drawer: $('#drawer'),
    drawerList: $('#drawerList'),
    drawerClose: $('#drawerClose'),

    settingsSheet: $('#settingsSheet'),
    settingsClose: $('#settingsClose'),
    proxyInput: $('#proxyInput'),
    builtinProxyNote: $('#builtinProxyNote'),
    autoProxyInput: $('#autoProxyInput'),
    autoplayInput: $('#autoplayInput'),
    bigFocusInput: $('#bigFocusInput'),
    resetBtn: $('#resetBtn'),
    appVer: $('#appVer'),

    helpSheet: $('#helpSheet'),
    helpClose: $('#helpClose'),

    toast: $('#toast'),
  };

  /* ── Preferences ────────────────────────────────────────────────────────── */
  const STORE_KEY = 'mmtv.prefs.v1';
  const defaults = {
    proxyUrl: '',
    autoProxy: true,
    autoplay: true,
    bigFocus: false,
    volume: 1,
    muted: false,
    lastChannel: '',
  };
  const prefs = Object.assign({}, defaults, readJSON(STORE_KEY));

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  }

  /* ── Visual helpers ─────────────────────────────────────────────────────── */

  /** "MRTV Sports" → "MS"; "MITV" → "MIT" */
  function initials(text) {
    const words = String(text).trim().split(/[\s\-_/]+/).filter(Boolean);
    if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
    return String(text).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
  }

  /** Lighten (positive) or darken (negative) a hex colour. */
  function shade(hex, amount) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (Number.isNaN(n)) return hex;
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const r = c(((n >> 16) & 255) + amount);
    const g = c(((n >> 8) & 255) + amount);
    const b = c((n & 255) + amount);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  function makeMono(channel) {
    const span = document.createElement('span');
    span.className = 'mono';
    span.textContent = initials(channel.name);
    const base = channel.color || '#475569';
    span.style.setProperty('--mono-a', shade(base, 52));
    span.style.setProperty('--mono-b', shade(base, -58));
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  /** Render a channel logo into a plate, falling back to a monogram tile. */
  function paintPlate(plate, channel) {
    plate.replaceChildren();
    if (!channel || !channel.logo) { if (channel) plate.appendChild(makeMono(channel)); return; }
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      if (plate.isConnected) plate.replaceChildren(makeMono(channel));
    }, { once: true });
    img.src = channel.logo;
    plate.appendChild(img);
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { dom.toast.hidden = true; }, ms);
  }

  /* ── State ──────────────────────────────────────────────────────────────── */
  const state = {
    category: 'All',
    query: '',
    current: null,
    hls: null,
    levels: [],
    viaProxy: false,
    forceProxyFor: null,   // channel id that should always go through the proxy
    builtinProxy: '',      // same-origin /api/proxy, detected on boot when deployed on Vercel
    overlay: null,
    lastHomeFocus: null,
    watchdog: null,
    stallCount: 0,
    lastTime: 0,
    recoverCount: 0,
    networkRetries: 0,
    startTimer: null,
  };

  /* ══════════════════════════════════════════════════════════════════════════
     HOME — filters, grid, resume
     ══════════════════════════════════════════════════════════════════════════ */

  function buildFilters() {
    dom.filters.replaceChildren();
    const frag = document.createDocumentFragment();
    // Count every channel the grid can show (including any flagged offline) so
    // the chip totals always add up to the grid's headline number.
    CATEGORIES.forEach((cat) => {
      const count = cat === 'All' ? CHANNELS.length : CHANNELS.filter((c) => c.category === cat).length;
      if (cat !== 'All' && count === 0) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.focusable = '';
      chip.dataset.cat = cat;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(state.category === cat));
      chip.textContent = `${cat} · ${count}`;
      chip.addEventListener('click', () => setCategory(cat));
      frag.appendChild(chip);
    });
    dom.filters.appendChild(frag);
  }

  function setCategory(cat) {
    state.category = cat;
    $$('.chip', dom.filters).forEach((c) => c.setAttribute('aria-selected', String(c.dataset.cat === cat)));
    renderGrid();
    if (document.documentElement.classList.contains('kbd-nav')) {
      const first = $('.card', dom.grid);
      if (first) first.focus({ preventScroll: true });
    }
  }

  function visibleChannels() {
    const q = state.query.trim().toLowerCase();
    return CHANNELS.filter((c) => {
      if (state.category !== 'All' && c.category !== state.category) return false;
      if (!q) return true;
      return [c.name, c.full, c.category, c.language, c.short]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
    });
  }

  function cardFor(channel) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.channelId = channel.id;
    card.dataset.focusable = '';
    card.setAttribute('aria-label',
      `${channel.name}${channel.offline ? ' — currently unavailable' : ''}. ${channel.full || channel.category}.`);

    const plate = document.createElement('span');
    plate.className = 'plate';
    card.appendChild(plate);
    paintPlate(plate, channel);

    const badge = document.createElement('span');
    badge.className = channel.offline ? 'card__offline' : 'card__live';
    if (channel.offline) badge.textContent = 'Offline';
    else badge.innerHTML = '<i></i>LIVE';
    card.appendChild(badge);

    const body = document.createElement('span');
    body.className = 'card__body';
    const name = document.createElement('span');
    name.className = 'card__name';
    name.textContent = channel.name;
    const sub = document.createElement('span');
    sub.className = 'card__sub';
    const cat = document.createElement('span');
    cat.textContent = channel.category;
    sub.appendChild(cat);
    if (channel.quality) {
      const q = document.createElement('span');
      q.className = 'card__q';
      q.textContent = channel.quality;
      sub.appendChild(q);
    }
    body.append(name, sub);
    card.appendChild(body);

    card.addEventListener('click', () => {
      if (channel.offline) { toast(`${channel.name} is offline right now`); return; }
      openChannel(channel.id);
    });
    return card;
  }

  function renderGrid() {
    const list = visibleChannels();
    dom.grid.replaceChildren();
    const frag = document.createDocumentFragment();
    list.forEach((channel) => frag.appendChild(cardFor(channel)));
    dom.grid.appendChild(frag);

    dom.gridTitle.textContent = state.category === 'All' ? 'All channels' : state.category;
    dom.gridCount.textContent = `${list.length} channel${list.length === 1 ? '' : 's'}`;
    dom.emptyState.hidden = list.length !== 0;
    dom.emptyTerm.textContent = state.query;
  }

  function renderResume() {
    const last = byId(prefs.lastChannel);
    if (!last) { dom.resumeRail.hidden = true; return; }
    dom.resumeRail.hidden = false;
    dom.resumeName.textContent = last.name;
    dom.resumeBtn.dataset.resumeId = last.id;
    dom.resumeBtn.setAttribute('aria-label', `Resume ${last.name}`);
    paintPlate(dom.resumeThumb, last);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ROUTER — hash based, so the browser and TV Back buttons both work
     ══════════════════════════════════════════════════════════════════════════ */

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    const params = new URLSearchParams(query || '');

    if (path.startsWith('watch/')) {
      const channel = byId(decodeURIComponent(path.slice(6)));
      if (channel) { showPlayer(channel); return; }
    }
    const cat = params.get('cat');
    if (cat && CATEGORIES.includes(cat)) state.category = cat;
    showHome();
  }

  function openChannel(id) {
    const target = `#/watch/${id}`;
    if (location.hash === target) showPlayer(byId(id));
    else location.hash = target;
  }

  function showHome() {
    closeOverlays();
    releaseOrientation();
    teardownPlayer();
    state.current = null;
    dom.viewPlayer.hidden = true;
    dom.viewHome.hidden = false;
    dom.body.classList.remove('in-player');
    buildFilters();
    renderGrid();
    renderResume();
    requestAnimationFrame(() => {
      const back = state.lastHomeFocus;
      if (back && document.contains(back) && isVisible(back)) back.focus({ preventScroll: true });
      else focusFirst(dom.viewHome);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PLAYER
     ══════════════════════════════════════════════════════════════════════════ */

  function showPlayer(channel) {
    if (!channel) { go('#/'); return; }
    if (state.current && state.current.id === channel.id && !dom.viewPlayer.hidden) return;

    if (!dom.viewHome.hidden) state.lastHomeFocus = document.activeElement;
    state.current = channel;
    prefs.lastChannel = channel.id;
    savePrefs();

    dom.viewHome.hidden = true;
    dom.viewPlayer.hidden = false;
    dom.body.classList.add('in-player');
    closeOverlays();
    buildDrawer();

    dom.playerName.textContent = channel.name;
    dom.playerMeta.textContent = [channel.full || channel.category, channel.language]
      .filter(Boolean).join(' · ');
    paintPlate(dom.playerPlate, channel);

    startPlayback(channel);
    requestAnimationFrame(() => dom.backBtn.focus({ preventScroll: true }));
  }

  /**
   * Status chip text.
   *   persistent (default) — stays until replaced, e.g. "Via proxy"
   *   transient            — clears itself, e.g. "Switching to 360p…"
   */
  let statusTimer;
  function setStatus(text, transient) {
    clearTimeout(statusTimer);
    dom.statusChip.hidden = !text;
    dom.statusChip.textContent = text || '';
    if (text && transient) {
      statusTimer = setTimeout(() => {
        dom.statusChip.hidden = true;
        dom.statusChip.textContent = '';
      }, 2500);
    }
  }

  function setSpinner(on, text) {
    dom.spinner.hidden = !on;
    if (text) dom.spinnerText.textContent = text;
    // The spinner is itself chrome — keep the rest visible while it is up, and
    // start the auto-hide once it goes away.
    showControls();
  }

  function showError(title, msg, options) {
    setSpinner(false);
    dom.errTitle.textContent = title;
    dom.errMsg.textContent = msg;
    dom.proxyBtn.hidden = !(options && options.proxy && !!effectiveProxy());
    dom.errbox.hidden = false;
    // The chrome must stay visible behind a message, and the D-pad needs to be
    // able to reach the message's own buttons.
    showControls();
    // Only pull focus when the player is actually on screen — an error from a
    // background timeout must never yank focus away from the channel grid.
    if (!dom.viewPlayer.hidden && document.documentElement.classList.contains('kbd-nav')) {
      requestAnimationFrame(() => dom.retryBtn.focus({ preventScroll: true }));
    }
  }

  function hideError() {
    if (dom.errbox.hidden) return;
    dom.errbox.hidden = true;
    // A pending start-up timeout would otherwise pop the same message straight
    // back up the moment the user dismisses it.
    clearTimeout(state.startTimer);
    state.startTimer = null;
  }

  /**
   * Dismiss the error panel and return to watching.
   *
   * The panel previously only offered actions, so a viewer who simply wanted the
   * message out of the way had to leave the channel. Dismissing also lets the
   * watchdog resume: it is paused while an error is up, so it will retry on its
   * own if the picture really has stalled.
   */
  function dismissError() {
    hideError();
    if (!dom.viewPlayer.hidden && document.documentElement.classList.contains('kbd-nav')) {
      requestAnimationFrame(() => dom.backBtn.focus({ preventScroll: true }));
    }
  }

  /**
   * Which proxy should be used, if any?
   *   • an explicitly configured URL always wins — it is the user's choice
   *   • otherwise fall back to the built-in `/api/proxy` when this deployment
   *     ships one (Vercel), so blocked channels work with zero setup
   */
  function effectiveProxy() {
    return prefs.proxyUrl || state.builtinProxy || '';
  }

  /**
   * Resolve the URL to request.
   *   proxy=false → the broadcaster's own URL
   *   proxy=true  → routed through a proxy. Needed by hosts that send no CORS
   *                 headers, enforce a Referer allow-list, or are plain HTTP
   *                 (blocked as mixed content on an HTTPS page).
   */
  function resolveUrl(channel, proxy) {
    const base = effectiveProxy();
    if (!proxy || !base) return { url: channel.url, proxied: false };
    const trimmed = base.replace(/\/+$/, '');
    const sep = trimmed.includes('?') ? '&' : '?';
    return { url: `${trimmed}${sep}url=${encodeURIComponent(channel.url)}`, proxied: true };
  }

  /**
   * Would the browser block this outright as mixed content?
   * A few broadcasters (Fortune TV) only serve plain HTTP, so on an HTTPS page
   * the request never leaves the browser. That is deterministic, so we can say
   * why instead of showing a vague network error.
   *
   * The protocol is a parameter (defaulting to the page's) so the rule can be
   * unit tested without needing a real HTTPS origin.
   */
  function isMixedContent(url, protocol) {
    return (protocol || location.protocol) === 'https:' && /^http:\/\//i.test(url);
  }

  function startPlayback(channel, force) {
    if (!channel) return;
    teardownPlayer();
    hideError();
    dom.livePill.dataset.state = 'live';

    const wantsProxy = state.forceProxyFor === channel.id ||
      (!!channel.needsProxy && !!prefs.autoProxy);
    const target = resolveUrl(channel, !!(effectiveProxy() && wantsProxy));

    // Refuse up front rather than letting the request fail invisibly.
    if (isMixedContent(target.url)) {
      state.viaProxy = false;
      setStatus('');
      showError('This channel needs the proxy',
        `${channel.name} only broadcasts over plain HTTP, which browsers block on a secure (HTTPS) page. ` +
        'Deploy the included proxy (see README) and set it in Settings — the proxy fetches the stream server-side and serves it securely.',
        { proxy: true });
      return;
    }

    state.viaProxy = target.proxied;
    setStatus(target.proxied ? 'Via proxy' : '');
    playUrl(target.url, channel, !!force);
  }

  /**
   * hls.js tuning, aimed at three things: start fast, recover fast, and change
   * quality smoothly. The values are informed by measuring these streams:
   *
   *   segments are 4s (Mahar) to 10-18s (DVB)
   *   segment sizes are 0.4 MB (Mahar 360p) to 2.3 MB (Fortune)
   *
   * A count-based live sync of 3 therefore meant very different pre-roll per
   * channel — 12s of video on Mahar but 31s on DVB — so the target is set in
   * seconds and normalised across all of them.
   */
  const HLS_CONFIG = {
    enableWorker: true,

    // ── Start playing sooner ────────────────────────────────────────────────
    // Open on a light rendition and let ABR climb. A high starting estimate
    // makes the first fragment big, which is what makes a live channel feel
    // slow to open.
    abrEwmaDefaultEstimate: 600000,   // ~600 kbps
    startLevel: -1,                   // let ABR choose using that estimate

    // ── Sit closer to the live edge ─────────────────────────────────────────
    // A time-based target so every channel lands at a similar wall-clock delay.
    // hls.js refuses to mix the time-based and count-based families, so only
    // these two are set — adding liveSyncDurationCount here throws at startup.
    liveSyncDuration: 10,
    liveMaxLatencyDuration: 30,
    // If playback drifts behind, catch up gently rather than seeking (seeking
    // on a live stream causes a visible jump and another buffering pause).
    maxLiveSyncPlaybackRate: 1.5,

    // ── Buffer ──────────────────────────────────────────────────────────────
    // Live needs far less look-ahead than VOD; a smaller target means less to
    // refill after a dropout, so recovery is quicker.
    maxBufferLength: 16,
    maxMaxBufferLength: 40,
    backBufferLength: 15,
    maxBufferSize: 40 * 1000 * 1000,

    // ── ABR: drop quickly, climb back cautiously ────────────────────────────
    // Several broadcasters mislabel their master playlist. Fortune TV advertises
    // 720p tiers as "1080p @ 2 Mbps" and "480p @ 1 Mbps" while serving the same
    // 3 Mbps encode for both — so trust measured throughput, not declarations.
    abrMaxWithRealBitrate: true,
    abrBandWidthFactor: 0.8,    // down-switch sooner when bandwidth dips
    abrBandWidthUpFactor: 0.6,  // climb back more cautiously → less oscillation
    abrEwmaFastLive: 3,
    abrEwmaSlowLive: 9,

    // ── Recover from stalls without a full restart ──────────────────────────
    highBufferWatchdogPeriod: 2,
    nudgeOffset: 0.2,
    nudgeMaxRetry: 5,

    // ── Fail fast, retry hard ───────────────────────────────────────────────
    // Retrying within a few hundred ms recovers from a dropped packet long
    // before the viewer notices; the old 800ms delays made every hiccup visible.
    manifestLoadingTimeOut: 8000,
    manifestLoadingMaxRetry: 4,
    manifestLoadingRetryDelay: 300,
    levelLoadingTimeOut: 8000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 300,
    fragLoadingTimeOut: 12000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 300,
    appendErrorMaxRetry: 5,
  };

  function playUrl(url, channel, force) {
    const video = dom.video;
    setSpinner(true, 'Connecting…');
    state.recoverCount = 0;
    state.networkRetries = 0;

    if (state.hls) { try { state.hls.destroy(); } catch { /* noop */ } state.hls = null; }
    state.levels = [];

    const canHlsJs = !!window.Hls && window.Hls.isSupported();
    const nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');

    if (canHlsJs) {
      // Construct defensively: a rejected config throws here, and an uncaught
      // throw would leave the player spinning forever with no explanation.
      let hls;
      try {
        hls = new window.Hls(HLS_CONFIG);
      } catch (error) {
        showError('Player configuration error',
          `The video engine rejected its settings: ${error && error.message ? error.message : error}`);
        return;
      }
      state.hls = hls;
      hls.on(window.Hls.Events.MANIFEST_PARSED, (_event, data) => {
        state.levels = data.levels || [];
        renderQuality();
      });
      hls.on(window.Hls.Events.LEVEL_SWITCHED, renderQuality);
      // Report quality changes so a visible dip explains itself.
      hls.on(window.Hls.Events.LEVEL_SWITCHING, (_event, data) => {
        const level = state.levels[data.level];
        if (level && level.height) setStatus(`Switching to ${level.height}p…`, true);
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => onHlsError(data, channel));
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (nativeHls) {
      video.src = url;
    } else {
      showError('HLS is not supported here',
        'This browser cannot play HLS video natively. On iPhone or iPad, open this page in Safari.');
      return;
    }

    video.volume = prefs.volume;
    video.muted = !!prefs.muted;

    if (force || prefs.autoplay) {
      const promise = video.play();
      if (promise && promise.catch) promise.catch(() => { setSpinner(false); showControls(); });
      startStartTimeout();
    } else {
      // Waiting on a deliberate press of Play — nothing to time out yet.
      setSpinner(false);
      showControls();
    }
    startWatchdog();
  }

  /**
   * A playlist can load and fragments can arrive while the pipeline still never
   * produces a frame (dead encoder, unsupported codec, or a stalled origin).
   * Without this the UI would spin forever, so bail out with a real message.
   */
  function startStartTimeout() {
    clearTimeout(state.startTimer);
    state.startTimer = setTimeout(() => {
      if (dom.viewPlayer.hidden) return;
      const video = dom.video;
      if (!video.paused && video.readyState >= 2) return;
      setSpinner(false);
      showError('The stream is not responding',
        'The playlist loaded but no video arrived. The channel may be offline, or its encoder may be down. Try again, or pick another channel.',
        { proxy: true });
    }, 20000);
  }

  function onHlsError(data, channel) {
    const Hls = window.Hls;
    if (!data || !Hls) return;

    if (!data.fatal) {
      if (data.details && /bufferStalled|fragLoadError|levelLoadError/i.test(data.details)) {
        setStatus('Reconnecting…', true);
      }
      return;
    }

    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      // Recovery ladder, cheapest first. A full teardown costs a manifest fetch,
      // a playlist fetch and a fresh fragment before the picture returns, so try
      // to avoid it while a lighter option might still work.
      state.networkRetries = (state.networkRetries || 0) + 1;

      // 1. Restart the loader — keeps the media source and buffered video.
      if (state.networkRetries === 1 && state.hls) {
        try {
          setStatus('Reconnecting…', true);
          state.hls.startLoad(-1);
          return;
        } catch { /* fall through to the next rung */ }
      }

      // 2. Step down a rendition — a lighter stream may survive a weak link.
      if (state.networkRetries === 2 && levelsDiffer()) {
        stepDownOnTrouble();
        setStatus('Switching quality…', true);
        try { state.hls.startLoad(-1); return; } catch { /* fall through */ }
      }

      // 3. Route through the proxy — often what a broadcaster's CORS or referer
      //    rule needs, and it also fixes mixed content.
      if (!state.viaProxy && effectiveProxy()) {
        const target = resolveUrl(channel, true);
        state.viaProxy = target.proxied;
        setStatus('Retrying via proxy…', true);
        setSpinner(true, 'Retrying via proxy…');
        setTimeout(() => playUrl(target.url, channel, true), 300);
        return;
      }

      // 4. Full restart, which resets the ladder for the next attempt.
      if (state.networkRetries <= 4) {
        setStatus('Reconnecting…', true);
        setTimeout(() => startPlayback(channel, true), 400);
        return;
      }

      showError('Cannot reach the stream',
        'The broadcaster refused the connection. The channel may be temporarily down, or it may need the CORS proxy.',
        { proxy: true });
      return;
    }

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      // Give hls.js a couple of self-healing attempts, then be honest with the user.
      if (state.recoverCount < 2) {
        state.recoverCount += 1;
        setStatus('Recovering…', true);
        try { state.hls.recoverMediaError(); return; } catch { /* fall through */ }
      }
      showError('This channel will not play',
        'The video could not be decoded. The stream may be broken, or your browser may be missing the codec it needs.');
      return;
    }

    if (data.type === Hls.ErrorTypes.MUX_ERROR) {
      showError('Broken stream', 'The broadcaster is sending malformed video data.');
      return;
    }

    showError('Stream unavailable', 'The stream ended unexpectedly or the link has changed.', { proxy: true });
  }

  /** Live links sometimes stall silently — reload the stream if time stops moving. */
  function startWatchdog() {
    clearInterval(state.watchdog);
    state.stallCount = 0;
    state.lastTime = dom.video.currentTime;
    // 2s polls with 2 strikes: a stall is caught in ~6s instead of ~15s, which
    // is the difference between "a brief hiccup" and "the channel froze".
    state.watchdog = setInterval(() => {
      if (dom.viewPlayer.hidden || !state.current || !dom.errbox.hidden) return;
      const video = dom.video;
      if (video.paused || video.readyState < 2) { state.lastTime = video.currentTime; return; }
      if (video.currentTime === state.lastTime) {
        state.stallCount += 1;
        if (state.stallCount >= 2) {
          state.stallCount = 0;
          if (recoverStalledPlayback()) return;
          setStatus('Reconnecting…');
          startPlayback(state.current, true);
        }
      } else {
        state.stallCount = 0;
        state.lastTime = video.currentTime;
        if (!state.viaProxy) setStatus('');
      }
    }, 2000);
  }

  /**
   * First-line recovery for a stalled live stream.
   *
   * hls.js can restart its loader without rebuilding the media source, which
   * keeps the buffered video and reconnects in a fraction of the time a full
   * teardown costs. Only fall back to a complete restart if that fails.
   */
  function recoverStalledPlayback() {
    const hls = state.hls;
    if (!hls) return false;
    try {
      state.recoverCount += 1;
      if (state.recoverCount > 2) return false;   // stop looping; do a full restart
      setStatus('Reconnecting…', true);
      // If we are hanging on a heavy rendition, step down one on the way back.
      stepDownOnTrouble();
      hls.startLoad(-1);                          // -1: resume from the live edge
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Drop to a lighter rendition after repeated trouble.
   *
   * Only useful when the renditions actually differ — several broadcasters
   * advertise tiers that are the same encode, in which case this is a harmless
   * no-op. `tools/diagnostics.html` reports the true per-rendition sizes.
   */
  function stepDownOnTrouble() {
    const hls = state.hls;
    if (!hls || !state.levels || state.levels.length < 2) return;
    if (!levelsDiffer()) return;
    const current = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
    if (current > 0) {
      hls.currentLevel = current - 1;
      renderQuality();
    }
  }

  /**
   * Do the advertised renditions actually have different bitrates?
   *
   * Some broadcasters list tiers that are the same encode behind different
   * URIs, so switching gains nothing. Their master playlists are not
   * trustworthy either — Fortune TV advertises a 480p @ 1 Mbps tier while
   * actually serving 1280x720 @ 3 Mbps on both URIs — so this compares the
   * declared values only as a rough signal, and `abrMaxWithRealBitrate` is what
   * actually keeps the ABR honest. `tools/diagnostics.html` measures the real
   * per-rendition sizes when you need the truth.
   */
  function levelsDiffer() {
    const rates = (state.levels || []).map((l) => l.bitrate || 0).filter(Boolean);
    if (rates.length < 2) return false;
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    return min > 0 && max / min >= 1.3;
  }

  function teardownPlayer() {
    clearInterval(state.watchdog);
    state.watchdog = null;
    clearTimeout(state.startTimer);
    state.startTimer = null;
    clearTimeout(hideTimer);
    hideTimer = null;
    dom.stage.classList.remove('controls-hidden');
    if (state.hls) { try { state.hls.destroy(); } catch { /* noop */ } state.hls = null; }
    const video = dom.video;
    try { video.pause(); } catch { /* noop */ }
    video.removeAttribute('src');
    try { video.load(); } catch { /* noop */ }
    setSpinner(false);
    hideError();
    setStatus('');
  }

  function renderQuality() {
    const hls = state.hls;
    if (!hls || !state.levels.length) { dom.qualityLabel.textContent = 'Auto'; return; }
    const level = state.levels[hls.currentLevel];
    const height = level && level.height ? `${level.height}p` : '';
    dom.qualityLabel.textContent = hls.autoLevelEnabled
      ? (height ? `Auto · ${height}` : 'Auto')
      : (height || 'Auto');
  }

  function cycleQuality() {
    const hls = state.hls;
    if (!hls || state.levels.length < 2) { toast('Only one quality level available'); return; }
    const next = hls.currentLevel + 1;
    hls.currentLevel = next >= state.levels.length ? -1 : next;
    renderQuality();
    toast(hls.currentLevel < 0 ? 'Quality: Auto' : `Quality: ${dom.qualityLabel.textContent}`);
  }

  /* ── Channel switcher ───────────────────────────────────────────────────── */
  function buildDrawer() {
    dom.drawerList.replaceChildren();
    const frag = document.createDocumentFragment();
    liveChannels().forEach((channel) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'draweritem';
      item.dataset.focusable = '';
      item.dataset.channelId = channel.id;
      item.setAttribute('aria-label', channel.name);
      if (state.current && state.current.id === channel.id) item.setAttribute('aria-current', 'true');

      const plate = document.createElement('span');
      plate.className = 'plate plate--sm';
      paintPlate(plate, channel);

      const txt = document.createElement('span');
      txt.className = 'draweritem__txt';
      const strong = document.createElement('strong');
      strong.textContent = channel.name;
      const small = document.createElement('small');
      small.textContent = `${channel.category} · ${channel.quality}`;
      txt.append(strong, small);

      item.append(plate, txt);
      if (state.current && state.current.id === channel.id) {
        const now = document.createElement('span');
        now.className = 'draweritem__now';
        now.textContent = 'NOW';
        item.appendChild(now);
      }
      item.addEventListener('click', () => { closeOverlays(); openChannel(channel.id); });
      frag.appendChild(item);
    });
    dom.drawerList.appendChild(frag);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     OVERLAYS
     ══════════════════════════════════════════════════════════════════════════ */

  function openOverlay(which) {
    state.overlay = which;
    if (which === 'drawer') dom.drawer.hidden = false;
    if (which === 'settings') {
      dom.proxyInput.value = prefs.proxyUrl || '';
      dom.builtinProxyNote.hidden = !state.builtinProxy;
      dom.autoProxyInput.checked = !!prefs.autoProxy;
      dom.autoplayInput.checked = !!prefs.autoplay;
      dom.bigFocusInput.checked = !!prefs.bigFocus;
      dom.appVer.textContent = APP_VERSION;
      dom.settingsSheet.hidden = false;
    }
    if (which === 'help') dom.helpSheet.hidden = false;

    requestAnimationFrame(() => {
      if (which === 'settings') dom.settingsClose.focus({ preventScroll: true });
      else if (which === 'help') dom.helpClose.focus({ preventScroll: true });
      else if (which === 'drawer') {
        const current = $(`[data-channel-id="${state.current ? state.current.id : ''}"]`, dom.drawerList);
        const fallback = dom.drawerList.querySelector('[data-focusable]') || dom.drawerClose;
        (current || fallback).focus({ preventScroll: true });
      }
    });
  }

  function closeOverlays() {
    const wasPlayer = !dom.viewPlayer.hidden;
    state.overlay = null;
    dom.settingsSheet.hidden = true;
    dom.helpSheet.hidden = true;
    dom.drawer.hidden = true;
    if (wasPlayer && document.documentElement.classList.contains('kbd-nav')) {
      requestAnimationFrame(() => dom.backBtn.focus({ preventScroll: true }));
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SPATIAL NAVIGATION (D-pad + arrow keys)
     ══════════════════════════════════════════════════════════════════════════ */

  function focusScope() {
    if (state.overlay === 'settings') return dom.settingsSheet;
    if (state.overlay === 'help') return dom.helpSheet;
    if (state.overlay === 'drawer') return dom.drawer;
    // A visible message sits on top of the player, so the controls it covers
    // must not be reachable — otherwise the D-pad walks onto buttons the
    // viewer cannot see.
    if (!dom.errbox.hidden) return dom.errbox;
    if (!dom.viewPlayer.hidden) return dom.viewPlayer;
    return dom.body;
  }

  function isVisible(el) {
    if (!el || el.disabled || el.closest('[hidden]')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  /**
   * Move focus to the nearest focusable element in a direction. Candidates must
   * lie in that direction; they are scored by primary-axis distance plus a
   * misalignment penalty, with a large bonus when they overlap on the cross
   * axis — which makes grid columns and rows feel predictable on a remote.
   */
  function move(direction) {
    const scope = focusScope();
    const items = $$('[data-focusable]', scope).filter(isVisible);
    if (!items.length) return false;

    const active = document.activeElement;
    if (!active || items.indexOf(active) === -1) {
      items[0].focus({ preventScroll: true });
      items[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return true;
    }

    const a = active.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < items.length; i += 1) {
      const el = items[i];
      if (el === active) continue;
      const b = el.getBoundingClientRect();
      const dx = (b.left + b.width / 2) - ax;
      const dy = (b.top + b.height / 2) - ay;

      let primary;
      let overlap;
      if (direction === 'left' || direction === 'right') {
        primary = direction === 'left' ? -dx : dx;
        overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      } else {
        primary = direction === 'up' ? -dy : dy;
        overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      }
      if (primary <= 4) continue;

      // Overlapping on the cross axis means the target is "straight ahead", so
      // the misalignment cost collapses to zero. Otherwise it is the size of the
      // gap between the two boxes, which stays meaningful when tiles differ in
      // height (e.g. a card next to an offline one). The tiny euclidean term
      // only breaks exact ties, keeping the pick stable and predictable.
      const misalign = overlap > 0 ? 0 : -overlap;
      const score = primary + misalign * 2.2 + Math.hypot(dx, dy) * 0.001;
      if (score < bestScore) { bestScore = score; best = el; }
    }

    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return true;
  }

  function focusFirst(scope) {
    const el = $$('[data-focusable]', scope).filter(isVisible)[0];
    if (el) el.focus({ preventScroll: true });
  }

  function playNext(direction) {
    const list = liveChannels();
    const step = direction < 0 ? -1 : 1;
    const index = list.findIndex((c) => state.current && c.id === state.current.id);
    const next = list[(index + step + list.length) % list.length];
    if (next) openChannel(next.id);
  }

  /* ── Auto-hiding controls ───────────────────────────────────────────────── */

  const CONTROLS_HIDE_DELAY = 3500;
  let hideTimer = null;

  /**
   * Should the player chrome stay on screen right now?
   *
   * Anything that needs the viewer's attention keeps it up: a message, the
   * buffering spinner, an open panel, or a paused stream (where hiding would
   * leave a frozen frame and no way to see the controls).
   *
   * Note the video *playing* is deliberately not in this list — that is exactly
   * when the chrome should get out of the way.
   */
  function controlsShouldStay() {
    return !dom.errbox.hidden ||      // a message is showing
      !dom.spinner.hidden ||          // connecting or buffering
      !!state.overlay ||              // channel list, settings or help open
      dom.video.paused;               // paused — no reason to hide
  }

  /** Reveal the chrome, then arm the auto-hide unless something blocks it. */
  function showControls() {
    clearTimeout(hideTimer);
    hideTimer = null;
    dom.stage.classList.remove('controls-hidden');

    if (dom.viewPlayer.hidden || controlsShouldStay()) return;
    hideTimer = setTimeout(hideControls, CONTROLS_HIDE_DELAY);
  }

  function hideControls() {
    clearTimeout(hideTimer);
    hideTimer = null;
    if (dom.viewPlayer.hidden || controlsShouldStay()) return;

    // Never leave focus on a control that is about to become invisible,
    // otherwise the D-pad highlight sits on something the viewer cannot see.
    const active = document.activeElement;
    if (active && active !== dom.stage && dom.stage.contains(active)) {
      dom.stage.focus({ preventScroll: true });
    }
    dom.stage.classList.add('controls-hidden');
  }

  /** Tap/click on the video: reveal if hidden, otherwise get out of the way. */
  function toggleControls() {
    if (dom.stage.classList.contains('controls-hidden')) showControls();
    else hideControls();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     UI EVENTS
     ══════════════════════════════════════════════════════════════════════════ */

  /* Search */
  let searchTimer;
  dom.search.addEventListener('input', () => {
    dom.searchClear.hidden = !dom.search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = dom.search.value; renderGrid(); }, 160);
  });
  dom.searchClear.addEventListener('click', () => {
    dom.search.value = '';
    dom.searchClear.hidden = true;
    state.query = '';
    renderGrid();
    dom.search.focus();
  });

  /* Resume */
  dom.resumeBtn.addEventListener('click', () => {
    const id = dom.resumeBtn.dataset.resumeId;
    if (byId(id)) openChannel(id);
  });

  /* Player chrome */
  dom.backBtn.addEventListener('click', () => go('#/'));
  dom.listBtn.addEventListener('click', () => openOverlay('drawer'));
  dom.drawerClose.addEventListener('click', closeOverlays);
  dom.playBtn.addEventListener('click', togglePlay);
  dom.qualityBtn.addEventListener('click', cycleQuality);
  dom.fsBtn.addEventListener('click', toggleFullscreen);
  dom.rotateBtn.addEventListener('click', toggleRotate);
  dom.pipBtn.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await dom.video.requestPictureInPicture();
    } catch { toast('Picture-in-picture is not available here'); }
  });
  dom.muteBtn.addEventListener('click', () => {
    dom.video.muted = !dom.video.muted;
    prefs.muted = dom.video.muted;
    savePrefs();
  });
  dom.volume.addEventListener('input', () => {
    const value = Number(dom.volume.value);
    dom.video.volume = value;
    dom.video.muted = value === 0;
    prefs.volume = value;
    prefs.muted = dom.video.muted;
    savePrefs();
  });

  function togglePlay() {
    const video = dom.video;
    if (video.paused) video.play().catch(() => toast('Playback was blocked — press play again'));
    else video.pause();
  }

  function toggleFullscreen() {
    const el = dom.stage;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (request) request.call(el);
    else if (dom.video.webkitEnterFullscreen) dom.video.webkitEnterFullscreen();
  }

  /* ── Screen rotation (phones) ───────────────────────────────────────────── */

  const orientation = screen.orientation;
  const isHandheld = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  function currentOrientation() {
    if (orientation && orientation.type) {
      if (orientation.type.startsWith('landscape')) return 'landscape';
      if (orientation.type.startsWith('portrait')) return 'portrait';
    }
    // Fall back to the viewport shape (also covers browsers without the API).
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  }

  function syncRotate() {
    const landscape = currentOrientation() === 'landscape';
    dom.rotateBtn.classList.toggle('is-landscape', landscape);
    dom.rotateBtn.setAttribute('aria-label',
      landscape ? 'Rotate to portrait (R)' : 'Rotate to landscape (R)');
  }

  /**
   * Rotate the screen.
   *
   * Chromium (Android) can lock the real orientation, but only while the page is
   * fullscreen — so request fullscreen first. Safari has no orientation API at
   * all, so fall back to its native fullscreen video player, which handles
   * rotation itself. Anything else gets a plain instruction.
   */
  async function toggleRotate() {
    const target = currentOrientation() === 'landscape' ? 'portrait' : 'landscape';

    if (orientation && typeof orientation.lock === 'function') {
      try {
        if (!document.fullscreenElement) {
          const request = dom.stage.requestFullscreen || dom.stage.webkitRequestFullscreen;
          if (request) await request.call(dom.stage);
        }
        await orientation.lock(target);
        syncRotate();
        toast(target === 'landscape' ? 'Locked to landscape' : 'Locked to portrait');
        return;
      } catch { /* not permitted here — try the Safari path below */ }
    }

    // Safari: no orientation API. Its native player goes fullscreen and the
    // user can turn the device; that is the closest available behaviour.
    if (typeof dom.video.webkitEnterFullscreen === 'function') {
      dom.video.webkitEnterFullscreen();
      toast('Rotate your device to turn the screen');
      return;
    }

    toast('This browser cannot rotate the screen — turn the device instead');
  }

  /** Release any orientation lock when returning to the channel grid. */
  function releaseOrientation() {
    if (orientation && typeof orientation.unlock === 'function') {
      try { orientation.unlock(); } catch { /* already free */ }
    }
  }

  function syncTransport() {
    const video = dom.video;
    const muted = video.muted || video.volume === 0;
    $('.icon--play', dom.playBtn).hidden = !video.paused;
    $('.icon--pause', dom.playBtn).hidden = video.paused;
    $('.icon--vol', dom.muteBtn).hidden = muted;
    $('.icon--muted', dom.muteBtn).hidden = !muted;
    dom.muteBtn.setAttribute('aria-label', muted ? 'Unmute (M)' : 'Mute (M)');
    if (Math.abs(Number(dom.volume.value) - video.volume) > 0.001) dom.volume.value = String(video.volume);
  }

  /* Error actions */
  dom.retryBtn.addEventListener('click', () => { if (state.current) startPlayback(state.current, true); });
  dom.proxyBtn.addEventListener('click', () => {
    if (!state.current) return;
    if (!effectiveProxy()) { toast('Add a proxy URL in Settings first'); openOverlay('settings'); return; }
    state.forceProxyFor = state.current.id;
    hideError();
    startPlayback(state.current, true);
  });
  dom.nextBtn.addEventListener('click', () => playNext(1));
  dom.dismissBtn.addEventListener('click', dismissError);

  /* Video element */
  const video = dom.video;
  video.addEventListener('playing', () => {
    clearTimeout(state.startTimer);
    state.startTimer = null;
    state.recoverCount = 0;
    state.networkRetries = 0;
    setSpinner(false);
    hideError();
    dom.livePill.dataset.state = 'live';
    setStatus(state.viaProxy ? 'Via proxy' : '');
    syncTransport();
    showControls();
  });
  video.addEventListener('pause', () => {
    syncTransport();
    if (state.current) dom.livePill.dataset.state = 'paused';
    showControls();   // paused: stay visible so play is reachable
  });
  // These all change whether the chrome should be up, so re-evaluate.
  video.addEventListener('play', showControls);
  video.addEventListener('waiting', () => {
    if (!dom.errbox.hidden) return;
    setSpinner(true, 'Buffering…');
    setStatus('Buffering…', true);
  });
  video.addEventListener('volumechange', syncTransport);
  video.addEventListener('error', () => {
    if (state.hls) return;   // hls.js reports its own errors
    showError('Stream unavailable',
      'This stream could not be loaded. It may be offline, or the link has changed.', { proxy: true });
  });
  video.addEventListener('dblclick', toggleFullscreen);

  /* Stage interactions */
  dom.stage.addEventListener('click', (event) => {
    if (event.target.closest('.pbar, .errbox, .spinner')) return;
    // A click anywhere on the video reveals the chrome when it is hidden and
    // dismisses it when it is up — the usual behaviour for a video surface.
    toggleControls();
  });
  // Any pointer activity counts as "movement": reveal, then re-arm the timer.
  dom.stage.addEventListener('mousemove', showControls, { passive: true });
  dom.stage.addEventListener('pointerdown', showControls, { passive: true });
  dom.stage.addEventListener('touchstart', showControls, { passive: true });
  video.addEventListener('click', (event) => {
    event.stopPropagation();
    // Tapping the picture toggles the chrome rather than playback, so the first
    // tap on a phone always brings the controls back instead of pausing.
    toggleControls();
  });

  /* Sheets */
  dom.settingsBtn.addEventListener('click', () => openOverlay('settings'));
  dom.settingsClose.addEventListener('click', closeOverlays);
  dom.helpBtn.addEventListener('click', () => openOverlay('help'));
  dom.helpClose.addEventListener('click', closeOverlays);

  dom.proxyInput.addEventListener('change', () => {
    prefs.proxyUrl = dom.proxyInput.value.trim();
    savePrefs();
    toast(prefs.proxyUrl ? 'Proxy saved' : 'Proxy cleared');
  });
  dom.autoProxyInput.addEventListener('change', () => {
    prefs.autoProxy = dom.autoProxyInput.checked;
    savePrefs();
  });
  dom.autoplayInput.addEventListener('change', () => {
    prefs.autoplay = dom.autoplayInput.checked;
    savePrefs();
  });
  dom.bigFocusInput.addEventListener('change', () => {
    prefs.bigFocus = dom.bigFocusInput.checked;
    savePrefs();
    applyPrefs();
  });
  dom.resetBtn.addEventListener('click', () => {
    Object.assign(prefs, defaults, { lastChannel: prefs.lastChannel });
    savePrefs();
    applyPrefs();
    openOverlay('settings');
    toast('Preferences reset');
  });

  function applyPrefs() {
    dom.body.classList.toggle('big-focus', !!prefs.bigFocus);
    video.volume = prefs.volume;
    video.muted = !!prefs.muted;
    dom.volume.value = String(prefs.volume);
    syncTransport();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     GLOBAL KEYBOARD / TV REMOTE
     ══════════════════════════════════════════════════════════════════════════ */

  const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  // Backspace, Escape, plus the codes webOS / Tizen / Orsay remotes send for Back.
  const BACK_CODES = new Set([8, 27, 461, 10009, 10033]);
  const NATIVE_ACTIVATE = /^(BUTTON|INPUT|A|SELECT)$/;

  document.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toUpperCase();
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable;
    const direction = ARROWS[event.key];

    if (direction || !typing) document.documentElement.classList.add('kbd-nav');

    // Any key press counts as interaction, so bring the chrome back before the
    // key is acted on — otherwise a shortcut would fire with nothing visible.
    if (!typing && !dom.viewPlayer.hidden) showControls();

    if (!typing && BACK_CODES.has(event.keyCode)) {
      event.preventDefault();
      if (state.overlay) closeOverlays();
      // A visible message is the topmost layer, so Back clears it rather than
      // throwing the viewer out of the channel.
      else if (!dom.errbox.hidden) dismissError();
      else if (!dom.viewPlayer.hidden) go('#/');
      return;
    }

    if (direction) {
      // Inside a text field, arrows normally move the caret. On a TV remote
      // there is no other way out, so leave the field on Up/Down always, and on
      // Left/Right once the caret sits at the matching end of the text.
      if (typing && (tag === 'INPUT' || tag === 'TEXTAREA')) {
        const field = event.target;
        const start = typeof field.selectionStart === 'number' ? field.selectionStart : 0;
        const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : 0;
        const length = (field.value || '').length;
        const vertical = direction === 'up' || direction === 'down';
        const atEdge = (direction === 'left' && start === 0 && end === 0) ||
                       (direction === 'right' && start === length && end === length);
        if (!vertical && !atEdge) return;
      }
      event.preventDefault();
      if (!dom.viewPlayer.hidden && dom.stage.classList.contains('controls-hidden')) {
        showControls();
        return;
      }
      move(direction);
      return;
    }

    if (event.key === ' ' && !typing) {
      const active = document.activeElement;
      if (active && active.hasAttribute && active.hasAttribute('data-focusable') && !NATIVE_ACTIVATE.test(active.tagName)) {
        event.preventDefault();
        active.click();
        return;
      }
      if (!active || !NATIVE_ACTIVATE.test(active.tagName)) {
        event.preventDefault();
        togglePlay();
      }
      return;
    }

    if (typing) return;

    switch (event.key.toLowerCase()) {
      case 'm': event.preventDefault(); dom.muteBtn.click(); break;
      case 'f': event.preventDefault(); toggleFullscreen(); break;
      case 'r': event.preventDefault(); toggleRotate(); break;
      case 'c': event.preventDefault(); openOverlay('drawer'); break;
      case 'q': event.preventDefault(); cycleQuality(); break;
      case 'p': event.preventDefault(); togglePlay(); break;
      case 'n': event.preventDefault(); playNext(1); break;
      case '?': event.preventDefault(); openOverlay('help'); break;
      case '/': event.preventDefault(); dom.search.focus(); break;
      case 'mediaplaypause': event.preventDefault(); togglePlay(); break;
      default: break;
    }
  }, true);

  window.addEventListener('mousemove', () => {
    document.documentElement.classList.remove('kbd-nav');
    if (!dom.viewPlayer.hidden) showControls();
  }, { passive: true });
  window.addEventListener('pointerdown', () => {
    document.documentElement.classList.remove('kbd-nav');
    if (!dom.viewPlayer.hidden) showControls();
  }, { passive: true });

  /* Keep focus trapped inside an open sheet or drawer */
  document.addEventListener('focusin', (event) => {
    if (!state.overlay) return;
    const scope = focusScope();
    if (!scope.contains(event.target)) requestAnimationFrame(() => focusFirst(scope));
  });

  window.addEventListener('hashchange', route);

  /* ══════════════════════════════════════════════════════════════════════════
     PWA
     ══════════════════════════════════════════════════════════════════════════ */

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
    });
  }

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    dom.installBtn.hidden = false;
  });
  dom.installBtn.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try {
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') dom.installBtn.hidden = true;
    } catch { /* dismissed */ }
    installEvent = null;
  });
  window.addEventListener('appinstalled', () => { dom.installBtn.hidden = true; });

  window.addEventListener('online', () => toast('Back online'));
  window.addEventListener('offline', () => toast('You are offline'));

  /* ══════════════════════════════════════════════════════════════════════════
     BUILT-IN PROXY DETECTION
     When this app is deployed somewhere that ships `/api/proxy` (the Vercel
     function, or the included serverless handler), blocked channels work with
     no configuration. On a plain static host the probe fails and we quietly
     fall back to whatever the user configured.
     ══════════════════════════════════════════════════════════════════════════ */

  async function detectBuiltinProxy() {
    if (!location.protocol.startsWith('http')) return;
    const endpoint = new URL('api/proxy', document.baseURI).href;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (!response.ok) return;
      const type = response.headers.get('content-type') || '';
      // A static host would answer with index.html here; require our JSON shape.
      if (!type.includes('application/json')) return;
      const body = await response.json();
      if (body && body.service === 'mmtv-proxy' && body.ok) {
        state.builtinProxy = endpoint;
      }
    } catch { /* no built-in proxy available — that is fine */ }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     BOOT
     ══════════════════════════════════════════════════════════════════════════ */

  applyPrefs();
  buildFilters();
  renderResume();
  renderGrid();
  if (!location.hash) location.replace(location.pathname + '#/');
  route();

  // The rotate control is only useful on a handheld; hide it everywhere else.
  dom.rotateBtn.hidden = !isHandheld;
  if (isHandheld) {
    syncRotate();
    if (orientation && orientation.addEventListener) orientation.addEventListener('change', syncRotate);
    window.addEventListener('orientationchange', syncRotate);
    window.addEventListener('resize', syncRotate, { passive: true });
    document.addEventListener('fullscreenchange', syncRotate);
  }

  // Probe in the background so it never delays first paint.
  detectBuiltinProxy().then(() => {
    if (state.builtinProxy && !prefs.proxyUrl) {
      // Re-render so cards know a proxy is available, and refresh the sheet.
      renderGrid();
    }
  });

  /* Small debug surface for the browser console. */
  window.__mmtv = {
    state, prefs, CHANNELS, showPlayer, openChannel,
    isMixedContent, toggleRotate, syncRotate, currentOrientation,
    showControls, hideControls, controlsShouldStay,
  };
})();
