// Diffusion vers la TV depuis le lecteur.
// - AirPlay (Safari : iPhone, iPad, Mac) vers une Apple TV ou une TV compatible AirPlay 2 (Samsung, LG, Sony…).
// - Chromecast (Chrome sur Android ou ordinateur) via le Cast SDK et le « Default Media Receiver » de Google.
//   Google ne fournit pas de cast web sur iPhone : là-bas, seul AirPlay est proposé.
// Tout est optionnel : sans appareil disponible, les boutons restent cachés.

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

/**
 * Chromecast. `getMedia()` renvoie { url, title, subtitle, image } du flux en cours.
 * `onStart(deviceName)` / `onEnd()` permettent au lecteur de couper puis reprendre la lecture locale.
 * Renvoie { castCurrent() } pour renvoyer une autre chaîne pendant une session (zapping).
 */
export function setupChromecast(button, { getMedia, onStart, onEnd, onError }) {
  button.hidden = true;
  const api = { castCurrent: () => {}, isCasting: () => false };
  // Le SDK ne fonctionne que dans Chrome (et navigateurs Chromium avec le module Cast) ; inutile ailleurs.
  const isChrome = !!window.chrome && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!isChrome) return api;

  let context = null;
  let casting = false;

  async function load() {
    const session = context.getCurrentSession();
    if (!session) return;
    const m = getMedia();
    if (!m) { onError?.(new Error('no-https')); return; }
    const info = new chrome.cast.media.MediaInfo(m.url, 'application/x-mpegURL');
    info.streamType = chrome.cast.media.StreamType.LIVE;
    info.metadata = new chrome.cast.media.GenericMediaMetadata();
    info.metadata.title = m.title;
    info.metadata.subtitle = m.subtitle || '';
    if (m.image) info.metadata.images = [new chrome.cast.Image(m.image)];
    const req = new chrome.cast.media.LoadRequest(info);
    req.autoplay = true;
    try {
      await session.loadMedia(req);
    } catch (e) {
      onError?.(e);
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
    const refresh = () => {
      const state = context.getCastState();
      button.hidden = state === fw.CastState.NO_DEVICES_AVAILABLE;
      button.textContent = state === fw.CastState.CONNECTED ? '📺 Arrêter le cast' : '📺 Caster';
    };
    context.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, refresh);
    context.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
      const S = fw.SessionState;
      if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) {
        casting = true;
        onStart?.(e.session.getCastDevice().friendlyName);
        load();
      } else if (e.sessionState === S.SESSION_ENDED) {
        casting = false;
        onEnd?.();
      }
    });
    refresh();
  };

  button.addEventListener('click', () => {
    if (!context) return;
    if (casting) context.endCurrentSession(true);
    else context.requestSession().catch(() => { /* sélection annulée */ });
  });

  const s = document.createElement('script');
  s.src = CAST_SDK;
  s.async = true;
  document.head.append(s);

  api.castCurrent = () => { if (casting) load(); };
  api.isCasting = () => casting;
  return api;
}
