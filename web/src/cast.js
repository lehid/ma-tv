// Diffusion vers la TV depuis le lecteur.
// - AirPlay (Safari : iPhone, iPad, Mac) vers une Apple TV ou une TV compatible AirPlay 2 (Samsung, LG, Sony…).
// - Chromecast (Chrome sur Android ou ordinateur) via le Cast SDK et le « Default Media Receiver » de Google.
//   Google ne fournit pas de cast web sur iPhone : là-bas, seul AirPlay est proposé.
// AirPlay n'apparaît que si un récepteur est détecté. Le bouton « Caster », lui, s'affiche dès que le SDK Cast
// est disponible, même sans appareil détecté : Chrome sur ordinateur ne cherche souvent les appareils qu'à
// l'ouverture de sa fenêtre de diffusion (ou pas du tout si macOS lui refuse le réseau local). En cas d'échec,
// `onHelp(html)` reçoit un panneau d'aide (voir cast-help.js).

import { castHelpHtml } from './cast-help.js';

const CAST_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

/** AirPlay : affiche `button` quand un récepteur est détecté, ouvre le sélecteur d'iOS au clic. */
export function setupAirPlay(video, button) {
  button.hidden = true;
  if (!window.WebKitPlaybackTargetAvailabilityEvent || typeof video.webkitShowPlaybackTargetPicker !== 'function') return;
  video.setAttribute('x-webkit-airplay', 'allow');
  video.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => {
    button.hidden = e.availability !== 'available';
  });
  button.addEventListener('click', () => {
    try { video.webkitShowPlaybackTargetPicker(); } catch (e) { /* sélecteur indisponible */ }
  });
}

/** Délai max d'un chargement sur la TV avant de signaler un échec (exporté pour les tests). */
export const LOAD_TIMEOUT_MS = 15000;

/** Code d'erreur de `requestSession()` : chaîne ou objet `{ code }` selon les versions du SDK. */
export function castErrorCode(e) {
  const code = typeof e === 'string' ? e : e && e.code;
  return String(code || '').toLowerCase();
}

/** Format des segments HLS deviné depuis l'URL : fMP4/CMAF ou MPEG-TS (le plus courant). */
export const looksFmp4 = (url) => /\.m4s(\?|#|$)|fmp4|cmaf/i.test(url || '');

/**
 * Chromecast. `getMedia()` renvoie { url, title, subtitle, image } du flux en cours.
 * `onStart(deviceName)` / `onEnd()` permettent au lecteur de couper puis reprendre la lecture locale.
 * `onError(err)` : la TV n'a pas pu lire le flux (y compris `Error('timeout')` après LOAD_TIMEOUT_MS).
 * `onHelp(html)` : panneau d'aide à afficher (aucun appareil trouvé, ou connexion impossible).
 * Renvoie { castCurrent() } pour renvoyer une autre chaîne pendant une session (zapping).
 */
export function setupChromecast(button, { getMedia, onStart, onEnd, onError, onHelp }) {
  button.hidden = true;
  const api = { castCurrent: () => {}, isCasting: () => false };
  // Le SDK ne fonctionne que dans Chrome (et navigateurs Chromium avec le module Cast) ; inutile ailleurs.
  const isChrome = !!window.chrome && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!isChrome) return api;

  let context = null;
  let casting = false;
  let loadToken = 0;

  async function load() {
    const session = context.getCurrentSession();
    if (!session) return;
    // Un seul verdict par chargement ; un zapping entre-temps rend l'ancien chargement muet.
    const token = ++loadToken;
    const m = getMedia();
    if (!m) { onError?.(new Error('no-https')); return; }
    const info = new chrome.cast.media.MediaInfo(m.url, 'application/x-mpegURL');
    // Sans ce réglage, le Default Media Receiver suppose parfois du MPEG-TS (ou l'inverse) et reste noir.
    const SegFmt = chrome.cast.media.HlsSegmentFormat;
    if (SegFmt) {
      const fmp4 = looksFmp4(m.url);
      info.hlsSegmentFormat = fmp4 ? SegFmt.FMP4 : SegFmt.TS;
      const VideoFmt = chrome.cast.media.HlsVideoSegmentFormat;
      if (fmp4 && VideoFmt) info.hlsVideoSegmentFormat = VideoFmt.FMP4;
    }
    info.streamType = chrome.cast.media.StreamType.LIVE;
    info.metadata = new chrome.cast.media.GenericMediaMetadata();
    info.metadata.title = m.title;
    info.metadata.subtitle = m.subtitle || '';
    if (m.image) info.metadata.images = [new chrome.cast.Image(m.image)];
    const req = new chrome.cast.media.LoadRequest(info);
    req.autoplay = true;
    let settled = false;
    const fail = (e) => {
      if (settled || token !== loadToken) return;
      settled = true;
      onError?.(e);
    };
    const timer = setTimeout(() => fail(new Error('timeout')), LOAD_TIMEOUT_MS);
    try {
      await session.loadMedia(req);
      settled = true;
    } catch (e) {
      fail(e);
    } finally {
      clearTimeout(timer);
    }
  }

  window.__onGCastApiAvailable = (ok) => {
    if (!ok || !window.cast?.framework) return;
    const fw = cast.framework;
    context = fw.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    // Bouton toujours visible ici : sans appareil détecté, un clic ouvre la fenêtre de Chrome (qui lance la
    // recherche) ou, à défaut, le panneau d'aide.
    const refresh = () => {
      const state = context.getCastState();
      button.hidden = false;
      button.textContent = state === fw.CastState.CONNECTED ? 'Arrêter la diffusion'
        : state === fw.CastState.CONNECTING ? 'Connexion…' : 'Caster';
    };
    context.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, refresh);
    context.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
      const S = fw.SessionState;
      if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) {
        casting = true;
        const before = loadToken;
        onStart?.(e.session.getCastDevice().friendlyName);
        if (loadToken === before) load(); // le lecteur n'a pas déjà envoyé la chaîne (castCurrent)
      } else if (e.sessionState === S.SESSION_ENDED) {
        casting = false;
        loadToken += 1; // plus de verdict attendu de la TV
        onEnd?.();
      }
    });
    refresh();
  };

  button.addEventListener('click', () => {
    if (!context) return;
    if (casting) context.endCurrentSession(true);
    else {
      Promise.resolve(context.requestSession()).catch((e) => {
        const code = castErrorCode(e);
        if (code === 'cancel') return; // fenêtre fermée par l'utilisateur
        onHelp?.(castHelpHtml(code === 'receiver_unavailable' || code === 'timeout' ? 'no-device' : 'failed'));
      });
    }
  });

  const s = document.createElement('script');
  s.src = CAST_SDK;
  s.async = true;
  document.head.append(s);

  api.castCurrent = () => { if (casting) load(); };
  api.isCasting = () => casting;
  return api;
}
