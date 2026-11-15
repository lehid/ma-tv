#!/usr/bin/env node
// Test de bout en bout de la diffusion Chromecast du lecteur (bouton « Caster », panneau d'aide, session, zapping).
// Le SDK Cast de Google est remplacé par un faux SDK (FAKE_SDK) servi à la place de gstatic.com,
// et les données par un catalogue de 3 chaînes de test : aucun réseau externe, aucune vraie TV.
// Suppose un `vite preview` déjà lancé :
//   npx vite build && npx vite preview --port 4223 --strictPort &
//   npm run e2e:cast -- http://localhost:4223/     (ou BASE_URL=… npm run e2e:cast)
// Hors `npm test` : il faut Chromium (Playwright ≥ 1.45 pour page.clock).
const { chromium } = require('playwright');

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:4223/').replace(/\/?$/, '/');
const results = [];
const errors = [];
let browser;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error(msg); }

// ---------------------------------------------------------------- données de test
// Alpha : un flux http de meilleure qualité (trié en premier) + un flux https → le cast doit prendre le https.
const CHANNELS = [
  { id: 'AlphaTest.fr@SD', name: 'Alpha Test', urls: [['http://alpha.example.test/live.m3u8', '1080p'], ['https://alpha.example.test/live.m3u8', '720p']] },
  { id: 'BravoTest.fr@SD', name: 'Bravo Test', urls: [['https://bravo.example.test/live.m3u8', '720p']] },
  { id: 'CharlieTest.fr@SD', name: 'Charlie Test', urls: [['https://charlie.example.test/live.m3u8', '720p']] },
];
const HTTPS_OF = Object.fromEntries(CHANNELS.map((c) => [c.name, c.urls.map((u) => u[0]).filter((u) => u.startsWith('https:'))]));
// Format tableau : voir scripts/build-playlist.mjs et web/src/data.js.
const CHANNELS_JSON = JSON.stringify({
  generatedAt: '2026-01-01T00:00:00.000Z',
  favorites: [],
  mine: CHANNELS.flatMap((c) => c.urls.map((u) => u[0])),
  countries: { FR: ['France', '🇫🇷'] },
  languages: { fra: 'French' },
  categories: ['news'],
  entries: CHANNELS.flatMap((c) => c.urls.map(([url, q]) => [c.id, c.name, 'FR', ['news'], ['fra'], 0, null, url, q, 0, 0, 0])),
});

// ---------------------------------------------------------------- faux SDK Cast
// Réglages lus à chaque appel dans window.__castCfg (posé par addInitScript, modifiable en cours de test) :
//   available : argument passé à __onGCastApiAvailable
//   devices   : false → CastState NO_DEVICES_AVAILABLE, true → NOT_CONNECTED
//   reject    : null (session acceptée) ou valeur de rejet de requestSession ('cancel', { code: 'timeout' }…)
//   load      : 'resolve' | 'pending' (loadMedia ne se résout jamais) | 'reject'
// Chaque appel est noté dans window.__castLog ; window.__castSetState(s) force un CastState.
const FAKE_SDK = `
(function () {
  var cfg = window.__castCfg || {};
  var log = window.__castLog = window.__castLog || [];
  var listeners = {};
  var session = null;
  var CS = { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', NOT_CONNECTED: 'NOT_CONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED' };
  var state = cfg.devices ? CS.NOT_CONNECTED : CS.NO_DEVICES_AVAILABLE;
  function fire(type, ev) { (listeners[type] || []).slice().forEach(function (f) { f(ev || {}); }); }
  function setState(s) { state = s; fire('caststatechanged', { castState: s }); }
  window.__castSetState = setState;

  window.chrome = window.chrome || {};
  chrome.cast = {
    isAvailable: true,
    AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped', TAB_AND_ORIGIN_SCOPED: 'tab_and_origin_scoped', PAGE_SCOPED: 'page_scoped' },
    ErrorCode: { CANCEL: 'cancel', TIMEOUT: 'timeout', API_NOT_INITIALIZED: 'api_not_initialized', INVALID_PARAMETER: 'invalid_parameter',
      EXTENSION_NOT_COMPATIBLE: 'extension_not_compatible', EXTENSION_MISSING: 'extension_missing', RECEIVER_UNAVAILABLE: 'receiver_unavailable',
      SESSION_ERROR: 'session_error', CHANNEL_ERROR: 'channel_error', LOAD_MEDIA_FAILED: 'load_media_failed' },
    Image: function (url) { this.url = url; },
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
      StreamType: { BUFFERED: 'BUFFERED', LIVE: 'LIVE', OTHER: 'OTHER' },
      MediaInfo: function (contentId, contentType) { this.contentId = contentId; this.contentType = contentType; },
      GenericMediaMetadata: function () {},
      LoadRequest: function (media) { this.media = media; },
    },
  };

  function makeSession() {
    return {
      getCastDevice: function () { return { friendlyName: 'TV du salon' }; },
      getSessionState: function () { return 'SESSION_STARTED'; },
      getMediaSession: function () { return null; },
      loadMedia: function (req) {
        var m = (req && req.media) || {};
        log.push({ t: 'loadMedia', contentId: m.contentId, contentType: m.contentType, title: m.metadata && m.metadata.title });
        var mode = (window.__castCfg || {}).load || 'resolve';
        if (mode === 'pending') return new Promise(function () {});
        if (mode === 'reject') return Promise.reject('load_media_failed');
        return Promise.resolve();
      },
      endSession: function (stop) { ctx.endCurrentSession(stop); },
    };
  }

  var ctx = {
    setOptions: function (o) { log.push({ t: 'setOptions', receiverApplicationId: o && o.receiverApplicationId }); },
    addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: function (t, f) { listeners[t] = (listeners[t] || []).filter(function (x) { return x !== f; }); },
    getCastState: function () { return state; },
    getSessionState: function () { return session ? 'SESSION_STARTED' : 'NO_SESSION'; },
    getCurrentSession: function () { return session; },
    requestSession: function () {
      var c = window.__castCfg || {};
      log.push({ t: 'requestSession' });
      var before = state;
      setState(CS.CONNECTING);
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (c.reject != null) { setState(before); reject(c.reject); return; }
          session = makeSession();
          setState(CS.CONNECTED);
          fire('sessionstatechanged', { sessionState: 'SESSION_STARTED', session: session });
          resolve(null);
        }, 100);
      });
    },
    endCurrentSession: function (stop) {
      log.push({ t: 'endCurrentSession', stop: stop });
      if (!session) return;
      session = null;
      setState(CS.NOT_CONNECTED);
      fire('sessionstatechanged', { sessionState: 'SESSION_ENDED' });
    },
  };

  window.cast = {
    framework: {
      CastContext: { getInstance: function () { return ctx; } },
      CastState: CS,
      SessionState: { NO_SESSION: 'NO_SESSION', SESSION_STARTING: 'SESSION_STARTING', SESSION_STARTED: 'SESSION_STARTED',
        SESSION_START_FAILED: 'SESSION_START_FAILED', SESSION_ENDING: 'SESSION_ENDING', SESSION_ENDED: 'SESSION_ENDED', SESSION_RESUMED: 'SESSION_RESUMED' },
      CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged', SESSION_STATE_CHANGED: 'sessionstatechanged' },
      RemotePlayer: function () {},
      RemotePlayerController: function () { this.addEventListener = function () {}; this.removeEventListener = function () {}; },
      RemotePlayerEventType: {},
    },
  };
  log.push({ t: 'sdkLoaded' });
  setTimeout(function () {
    if (typeof window.__onGCastApiAvailable === 'function') window.__onGCastApiAvailable(cfg.available !== false);
  }, 30);
})();`;

// ---------------------------------------------------------------- outils
/**
 * Nouvelle page isolée. `cfg` : réglages du faux SDK ; `chrome` : simuler Chrome (window.chrome) ;
 * `safari` : UA Safari et pas de window.chrome ; `clock` : installer page.clock avant le chargement.
 */
async function openApp(cfg = {}, { chrome = true, safari = false, clock = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: safari ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' : undefined,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000); // bouton caché → échec rapide plutôt que 30 s d'attente
  const net = { sdk: 0, hls: [] };
  page.on('pageerror', (e) => errors.push(e.message));
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (/gstatic\.com\/cv\/js\/sender/.test(url)) { net.sdk += 1; return route.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }); }
    if (/\/data\/channels\.json(\?|$)/.test(url)) return route.fulfill({ contentType: 'application/json', body: CHANNELS_JSON });
    if (/\/data\/status\.json(\?|$)/.test(url)) return route.fulfill({ contentType: 'application/json', body: '{}' });
    if (/\/data\/epg-now\.json(\?|$)/.test(url)) return route.fulfill({ contentType: 'application/json', body: '{"programmes":{}}' });
    // Flux de test : la lecture locale échoue (sans importance), mais on note chaque tentative.
    if (/\.m3u8|\.ts(\?|$)/.test(url)) { net.hls.push({ url, at: Date.now() }); return route.abort(); }
    if (url.startsWith(BASE)) return route.continue();
    return route.abort(); // aucun réseau externe (polices, logos…)
  });
  await page.addInitScript(({ cfg, chrome, safari }) => {
    window.__castCfg = cfg;
    window.__castLog = [];
    if (safari) { try { delete window.chrome; } catch (e) { /* rien */ } Object.defineProperty(window, 'chrome', { value: undefined, configurable: true, writable: true }); }
    else if (chrome) window.chrome = window.chrome || {};
  }, { cfg, chrome, safari });
  if (clock) await page.clock.install();
  await page.goto(`${BASE}index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.tile', { timeout: 15000 });
  return { page, ctx, net };
}

const ui = (page) => page.evaluate(() => {
  const p = document.querySelector('.player');
  const b = document.querySelector('.player [data-cast="chromecast"]');
  const m = document.querySelector('.player .player-msg');
  const help = m && (m.matches('[data-help]') ? m : m.querySelector('[data-help]'));
  const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  return {
    playerOpen: !!p && !p.hidden,
    castVisible: shown(b),
    castLabel: b ? b.textContent.replace(/\s+/g, ' ').trim() : null,
    msgVisible: !!m && !m.hidden,
    msg: m ? m.textContent.replace(/\s+/g, ' ').trim() : '',
    help: !!m && !m.hidden && !!help && shown(help) ? { kind: help.getAttribute('data-help'), text: help.textContent.replace(/\s+/g, ' ').trim(), close: !!help.querySelector('[data-help-close]') || !!m.querySelector('[data-help-close]') } : null,
    channel: p ? p.querySelector('h2').textContent : null,
    videoPaused: p ? p.querySelector('video').paused : null,
    log: window.__castLog || [],
  };
});

async function openChannel(page, name = 'Alpha Test') {
  const id = CHANNELS.find((c) => c.name === name).id;
  await page.click(`.tile[data-id="${id}"]`);
  await page.waitForFunction(() => !document.querySelector('.player').hidden, null, { timeout: 5000 });
}
/** Attend que le SDK ait appelé __onGCastApiAvailable (30 ms après son chargement) et que l'UI ait réagi. */
const settle = (page, ms = 400) => page.waitForTimeout(ms);

/** Télécommande Tizen/webOS : keyCode que le clavier ne produit pas (10009, 461, 428). */
async function remote(page, keyCode, key = 'Unidentified') {
  await page.evaluate(({ keyCode, key }) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
    Object.defineProperty(ev, 'which', { get: () => keyCode });
    (document.activeElement || document.body).dispatchEvent(ev);
  }, { keyCode, key });
  await page.waitForTimeout(150);
}

async function clickCast(page) {
  if (!(await ui(page)).castVisible) throw new Error('bouton « Caster » caché : impossible de cliquer');
  await page.click('.player [data-cast="chromecast"]');
  await page.waitForTimeout(350); // requestSession du faux SDK répond en 100 ms
}

const loads = (u) => u.log.filter((x) => x.t === 'loadMedia');
const short = (s, n = 70) => (s.length > n ? s.slice(0, n) + '…' : s);

async function scenario(name, fn) {
  let app;
  try {
    await fn((a) => { app = a; return a; });
    results.push([name, 'OK', '']);
  } catch (e) {
    results.push([name, 'ÉCHEC', String(e.message).split('\n')[0]]);
  } finally {
    if (app) await app.ctx.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- scénarios
(async () => {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  await scenario('1  Bouton visible sans appareil, libellés selon CastState', async (keep) => {
    const { page, net } = keep(await openApp({ devices: false }));
    await openChannel(page);
    await settle(page);
    check(net.sdk === 1, `SDK Cast chargé ${net.sdk} fois`);
    let u = await ui(page);
    check(u.castVisible, 'bouton « Caster » caché avec NO_DEVICES_AVAILABLE');
    check(u.castLabel === 'Caster', `libellé « ${u.castLabel} » au lieu de « Caster » (NO_DEVICES_AVAILABLE)`);
    for (const [state, want] of [['NOT_CONNECTED', 'Caster'], ['CONNECTING', 'Connexion…'], ['NO_DEVICES_AVAILABLE', 'Caster']]) {
      await page.evaluate((s) => window.__castSetState(s), state);
      await page.waitForTimeout(80);
      u = await ui(page);
      check(u.castVisible, `bouton caché avec ${state}`);
      check(u.castLabel === want, `libellé « ${u.castLabel} » au lieu de « ${want} » (${state})`);
    }
  });

  await scenario('2  Aucune TV (receiver_unavailable) : panneau, Retour le ferme, 2e Retour ferme le lecteur', async (keep) => {
    const { page } = keep(await openApp({ devices: false, reject: 'receiver_unavailable' }));
    for (const [first, second] of [['Escape', 'Escape'], [10009, 461]]) {
      await openChannel(page);
      await settle(page);
      await clickCast(page);
      let u = await ui(page);
      check(u.log.some((x) => x.t === 'requestSession'), 'requestSession() non appelé au clic');
      check(u.help, `pas de panneau [data-help] (message : « ${short(u.msg)} »)`);
      check(/Aucune TV trouvée/.test(u.help.text), `panneau sans « Aucune TV trouvée » : « ${short(u.help.text)} »`);
      check(u.help.close, 'panneau sans bouton [data-help-close]');
      if (first === 'Escape') await page.keyboard.press('Escape'); else await remote(page, first);
      await page.waitForTimeout(150);
      u = await ui(page);
      check(!u.help, `Retour (${first}) : panneau toujours affiché`);
      check(u.playerOpen, `Retour (${first}) : le lecteur s'est fermé avec le panneau`);
      if (second === 'Escape') await page.keyboard.press('Escape'); else await remote(page, second);
      await page.waitForTimeout(150);
      u = await ui(page);
      check(!u.playerOpen, `2e Retour (${second}) : lecteur toujours ouvert`);
    }
  });

  await scenario('2b Aucune TV ({ code: "timeout" }) : fermeture par [data-help-close]', async (keep) => {
    const { page } = keep(await openApp({ devices: false, reject: { code: 'timeout' } }));
    await openChannel(page);
    await settle(page);
    await clickCast(page);
    let u = await ui(page);
    check(u.help, `pas de panneau [data-help] (message : « ${short(u.msg)} »)`);
    check(/Aucune TV trouvée/.test(u.help.text), `panneau sans « Aucune TV trouvée » : « ${short(u.help.text)} »`);
    await page.click('.player-msg [data-help-close], .player-msg[data-help-close]');
    await page.waitForTimeout(150);
    u = await ui(page);
    check(!u.help, 'panneau toujours affiché après [data-help-close]');
    check(u.playerOpen, 'le lecteur s\'est fermé');
  });

  await scenario('3  Sélection annulée (cancel, chaîne puis objet) : aucun message', async (keep) => {
    const { page } = keep(await openApp({ devices: true, reject: 'cancel' }));
    await openChannel(page);
    await settle(page);
    for (const reject of ['cancel', { code: 'cancel' }]) {
      await page.evaluate((r) => { window.__castCfg.reject = r; }, reject);
      await clickCast(page);
      const u = await ui(page);
      const tag = typeof reject === 'string' ? '"cancel"' : '{ code: "cancel" }';
      check(u.log.filter((x) => x.t === 'requestSession').length >= 1, `${tag} : requestSession() non appelé`);
      check(!u.help, `${tag} : panneau d'aide affiché (« ${short(u.help ? u.help.text : '')} »)`);
      check(!/Aucune TV|n'a pas pu lancer/.test(u.msg), `${tag} : message « ${short(u.msg)} »`);
      check(u.castLabel === 'Caster', `${tag} : libellé « ${u.castLabel} » après annulation`);
    }
  });

  await scenario('3b Autre erreur (objet puis chaîne) : panneau « n\'a pas pu lancer »', async (keep) => {
    const { page } = keep(await openApp({ devices: true, reject: { code: 'session_error' } }));
    await openChannel(page);
    await settle(page);
    for (const reject of [{ code: 'session_error' }, 'extension_missing']) {
      await page.evaluate((r) => { window.__castCfg.reject = r; }, reject);
      await clickCast(page);
      const u = await ui(page);
      const tag = JSON.stringify(reject);
      check(u.help, `${tag} : pas de panneau [data-help] (message : « ${short(u.msg)} »)`);
      check(/La TV n'a pas pu lancer cette chaîne/.test(u.help.text), `${tag} : texte « ${short(u.help.text)} »`);
      check(!/Aucune TV trouvée/.test(u.help.text), `${tag} : panneau « Aucune TV » au lieu de « failed »`);
      check(u.help.close, `${tag} : panneau sans bouton [data-help-close]`);
      await page.click('.player-msg [data-help-close], .player-msg[data-help-close]');
      await page.waitForTimeout(150);
    }
  });

  await scenario('4  Session : loadMedia https, libellé, zapping, arrêt et reprise locale', async (keep) => {
    const { page, net } = keep(await openApp({ devices: true, load: 'resolve' }));
    await openChannel(page, 'Alpha Test');
    await settle(page, 800);
    await page.click('.player [data-cast="chromecast"]');
    let u = await ui(page);
    check(u.castLabel === 'Connexion…', `libellé pendant la connexion : « ${u.castLabel} »`);
    await page.waitForTimeout(400);
    u = await ui(page);
    let l = loads(u);
    check(l.length === 1, `${l.length} loadMedia après SESSION_STARTED au lieu de 1 (envoi en double ?)`);
    check(HTTPS_OF['Alpha Test'].includes(l[0].contentId), `contentId ${l[0].contentId} : pas le flux https d'Alpha Test`);
    check(l[0].contentType === 'application/x-mpegURL', `contentType ${l[0].contentType}`);
    check(u.castLabel === 'Arrêter la diffusion', `libellé « ${u.castLabel} » pendant la diffusion`);
    check(u.videoPaused, 'la lecture locale n\'est pas en pause');
    check(!u.help, `panneau d'aide pendant la diffusion : « ${short(u.help ? u.help.text : '')} »`);
    const castStart = Date.now();

    const zaps = [['bouton Suivante', () => page.click('.player [data-act="next"]')],
      ['PageDown', () => page.keyboard.press('PageDown')],
      ['keyCode 428', () => remote(page, 428)]];
    let prev = u.channel;
    for (const [how, act] of zaps) {
      const before = l.length;
      await act();
      await page.waitForTimeout(300);
      u = await ui(page);
      l = loads(u);
      const last = l[l.length - 1];
      check(l.length === before + 1, `${how} : ${l.length - before} loadMedia au lieu de 1`);
      check(u.channel !== prev, `${how} : la chaîne n'a pas changé`);
      check(last && last.contentId === HTTPS_OF[u.channel][0], `${how} : dernier loadMedia ${last && last.contentId} au lieu de ${HTTPS_OF[u.channel][0]} (${u.channel})`);
      prev = u.channel;
    }
    check(!net.hls.some((r) => r.at > castStart + 200), 'flux local demandé pendant la diffusion');

    const stopAt = Date.now();
    await page.click('.player [data-cast="chromecast"]');
    await page.waitForTimeout(200);
    u = await ui(page);
    check(u.log.some((x) => x.t === 'endCurrentSession'), 'endCurrentSession() non appelé');
    check(u.castLabel === 'Caster', `libellé « ${u.castLabel} » après l'arrêt`);
    const t0 = Date.now();
    while (!net.hls.some((r) => r.at >= stopAt) && Date.now() - t0 < 4000) await sleep(100);
    check(net.hls.some((r) => r.at >= stopAt), 'la lecture locale n\'a pas repris (aucun flux demandé après l\'arrêt)');
    check(!/Diffusion de/.test((await ui(page)).msg), 'message « Diffusion de … » toujours affiché');
  });

  await scenario('5  loadMedia sans réponse : échec affiché au bout de 15 s', async (keep) => {
    const { page } = keep(await openApp({ devices: true, load: 'pending' }, { clock: true }));
    await openChannel(page);
    await settle(page, 800);
    await clickCast(page);
    let u = await ui(page);
    check(loads(u).length >= 1, 'aucun loadMedia après SESSION_STARTED');
    const failRe = /pas pu|échou|impossible|ne répond|délai/i;
    await page.clock.fastForward(14000);
    await page.waitForTimeout(100);
    u = await ui(page);
    check(!failRe.test(u.msg), `échec affiché avant 15 s : « ${short(u.msg)} »`);
    await page.clock.fastForward(1500);
    await page.waitForTimeout(150);
    u = await ui(page);
    check(u.msgVisible && failRe.test(u.msg), `pas de message d'échec après 15,5 s (message : « ${short(u.msg)} »)`);
  });

  await scenario('6  SDK indisponible (__onGCastApiAvailable(false)) : bouton caché', async (keep) => {
    const { page, net } = keep(await openApp({ available: false, devices: true }));
    await openChannel(page);
    await settle(page);
    check(net.sdk === 1, `SDK Cast chargé ${net.sdk} fois`);
    const u = await ui(page);
    check(!u.castVisible, 'bouton « Caster » visible alors que le SDK est indisponible');
  });

  await scenario('6b Safari simulé (pas de window.chrome) : SDK non chargé, bouton caché', async (keep) => {
    const { page, net } = keep(await openApp({ devices: true }, { chrome: false, safari: true }));
    await openChannel(page);
    await settle(page);
    check(net.sdk === 0, `SDK Cast chargé ${net.sdk} fois sur Safari`);
    const u = await ui(page);
    check(!u.castVisible, 'bouton « Caster » visible sur Safari');
  });

  results.push(['7  Aucune erreur JavaScript', errors.length ? 'ÉCHEC' : 'OK', errors.slice(0, 3).join(' | ')]);

  await browser.close();
  const w = Math.max(...results.map((r) => r[0].length));
  for (const [n, s, m] of results) console.log(`${s === 'OK' ? 'OK   ' : 'ÉCHEC'}  ${n.padEnd(w)}  ${m}`);
  const ko = results.filter((r) => r[1] !== 'OK').length;
  console.log(`\n${results.length - ko}/${results.length} scénarios OK`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
