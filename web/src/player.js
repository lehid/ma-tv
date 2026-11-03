// Lecteur plein écran : hls.js (ou HLS natif sur Safari/Tizen/webOS), essais successifs des flux d'une chaîne.
// hls.js (~500 Ko) n'est chargé qu'au premier lancement d'une chaîne.
let HlsPromise;
const loadHls = () => (HlsPromise ||= import('hls.js').then((m) => m.default));
import { nowNext, hhmm } from './data.js';
import { KEYS } from './tv-nav.js';

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createPlayer({ getList, epg = {}, onToggleFavorite }) {
  const root = el(`
    <div class="player" hidden role="dialog" aria-label="Lecteur">
      <video playsinline webkit-playsinline autoplay></video>
      <div class="player-msg" hidden></div>
      <div class="osd">
        <span class="lcn"></span>
        <div><h2></h2><div class="now"></div><div class="progress" hidden><i></i></div></div>
        <div class="osd-actions">
          <button data-act="prev" aria-label="Chaîne précédente">CH− Préc.</button>
          <button data-act="next" aria-label="Chaîne suivante">CH+ Suiv.</button>
          <button data-act="fav">☆ Favori</button>
          <button data-act="alt">Autre flux</button>
          <button data-act="fs">⛶ Plein écran</button>
          <button data-act="close">✕ Fermer</button>
        </div>
      </div>
    </div>`);
  document.body.append(root);
  const video = root.querySelector('video');
  const msg = root.querySelector('.player-msg');
  let hls = null;
  let current = null;
  let streamIdx = 0;
  let idleTimer = null;
  let lastFocus = null;
  let playToken = 0;

  const showMsg = (html) => { msg.innerHTML = html; msg.hidden = !html; };
  const wake = () => {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add('idle'), 5000);
  };

  function renderOsd() {
    const c = current;
    root.querySelector('.lcn').textContent = String(c.lcn).padStart(3, '0');
    root.querySelector('h2').textContent = c.name;
    const { now, next, progress } = nowNext(epg, c.id);
    const nowEl = root.querySelector('.now');
    nowEl.innerHTML = [
      now && `<div><b>${hhmm(now[0])}</b>${esc(now[2])}</div>`,
      next && `<div><b>${hhmm(next[0])}</b>${esc(next[2])}</div>`,
    ].filter(Boolean).join('') || `<div>${esc(c.quality || '')} ${c.nsfw ? '· 🔞 Adulte' : ''}</div>`;
    const bar = root.querySelector('.progress');
    bar.hidden = !now;
    if (now) bar.firstChild.style.width = `${Math.round(progress * 100)}%`;
    root.querySelector('[data-act="fav"]').textContent = c.favorite ? '★ Favori' : '☆ Favori';
    root.querySelector('[data-act="alt"]').hidden = c.streams.length < 2;
  }

  function destroyHls() {
    if (hls) { hls.destroy(); hls = null; }
    video.onerror = null;
    video.removeAttribute('src');
  }

  // Lecture HLS native seulement chez Apple (iPhone, iPad, Mac : la voie la plus fiable) ou sans MediaSource.
  // Ailleurs hls.js, même si canPlayType répond « maybe » : les Chrome récents ou anciens sur Android le disent
  // aussi, avec une lecture native moins robuste.
  // Sur iPhone, hls.js passe par ManagedMediaSource, qui peut donner le son sans l'image.
  const hasNativeHls = () => !!video.canPlayType('application/vnd.apple.mpegurl')
    && (/Apple/.test(navigator.vendor || '') || !window.MediaSource);

  const NATIVE_TIMEOUT_MS = 15000; // pas de « playing » au bout de 15 s → flux suivant
  const NO_PICTURE_CHECK_MS = 2500; // délai après « playing » pour vérifier qu'il y a une image

  async function playStream() {
    destroyHls();
    const token = ++playToken;
    const alive = () => token === playToken;
    const s = current.streams[streamIdx];
    if (!s) {
      showMsg(`<strong>Aucun flux lisible ici.</strong><br>Cette chaîne est peut-être hors ligne, géo-bloquée ou refuse les navigateurs.
        Essaie-la dans VLC ou ton appli TV via la playlist. <br><br>▲▼ pour changer de chaîne.`);
      return;
    }
    if (location.protocol === 'https:' && s.url.startsWith('http:')) {
      // Contenu mixte bloqué par le navigateur : on passe au flux suivant.
      return tryNext(`Flux HTTP non lisible depuis une page HTTPS.`);
    }
    showMsg(`Connexion à <strong>${esc(current.name)}</strong>${current.streams.length > 1 ? ` · flux ${streamIdx + 1}/${current.streams.length}` : ''}…`);

    let started = false;
    video.addEventListener('playing', () => {
      if (!alive() || started) return;
      started = true;
      showMsg('');
      // Son sans image : piste vidéo absente ou codec non décodable sur cet appareil.
      setTimeout(() => {
        if (!alive() || video.videoWidth > 0) return;
        if (streamIdx + 1 < current.streams.length) tryNext('Pas d\'image (piste vidéo absente ou codec non supporté)');
        else showMsg('<strong>Son seulement.</strong><br>Ce flux n\'a pas d\'image lisible sur cet appareil. Essaie-le dans VLC ou ton appli TV.');
      }, NO_PICTURE_CHECK_MS);
    }, { once: true });

    if (hasNativeHls()) {
      video.onerror = () => { if (alive()) tryNext('Lecture impossible'); };
      setTimeout(() => { if (alive() && !started) tryNext('Pas de réponse du flux'); }, NATIVE_TIMEOUT_MS);
      video.src = s.url;
    } else {
      const Hls = await loadHls();
      if (!alive()) return; // l'utilisateur a déjà zappé
      if (!Hls.isSupported()) { showMsg('<strong>Ce navigateur ne sait pas lire ces flux.</strong><br>Utilise la playlist dans VLC ou ton appli TV.'); return; }
      video.disableRemotePlayback = true; // exigé par Apple pour ManagedMediaSource
      let recovered = false;
      hls = new Hls({ manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 2 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || !alive()) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
        tryNext(data.response?.code ? `Erreur HTTP ${data.response.code}` : 'Flux injoignable (hors ligne, géo-bloqué ou CORS)');
      });
      hls.loadSource(s.url);
      hls.attachMedia(video);
    }
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
  }

  function tryNext(reason) {
    console.warn(`[ma-tv] ${current.name} flux ${streamIdx + 1} : ${reason}`);
    streamIdx += 1;
    playStream();
  }

  function open(channel) {
    if (root.hidden) lastFocus = document.activeElement;
    current = channel;
    streamIdx = 0;
    root.hidden = false;
    renderOsd();
    playStream();
    wake();
    root.querySelector('[data-act="next"]').focus({ preventScroll: true });
    enterFullscreen({ auto: true });
  }

  // Plein écran : API standard (ordinateur, Android, iPad, TV) sur tout le lecteur pour garder l'OSD ;
  // sur iPhone, seule la <video> peut passer en plein écran (lecteur natif d'iOS).
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const canFsRoot = () => !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const canFsVideo = () => typeof video.webkitEnterFullscreen === 'function';
  const fsBtn = root.querySelector('[data-act="fs"]');

  function updateFsButton() {
    fsBtn.hidden = !canFsRoot() && !canFsVideo();
    fsBtn.textContent = fsElement() ? '⤡ Quitter' : '⛶ Plein écran';
  }

  function enterFullscreen({ auto = false } = {}) {
    try {
      if (canFsRoot()) {
        const req = root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen();
        Promise.resolve(req).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      } else if (!auto && canFsVideo()) {
        video.webkitEnterFullscreen(); // iPhone : pas d'appel automatique, il cacherait l'OSD
      }
    } catch (e) { /* plein écran refusé */ }
  }

  function exitFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
      if (video.webkitDisplayingFullscreen) video.webkitExitFullscreen();
    } catch (e) { /* rien à quitter */ }
  }

  const toggleFullscreen = () => (fsElement() ? exitFullscreen() : enterFullscreen());
  document.addEventListener('fullscreenchange', updateFsButton);
  document.addEventListener('webkitfullscreenchange', updateFsButton);
  updateFsButton();

  function zap(delta) {
    const list = getList();
    if (!list.length) return;
    const i = list.indexOf(current);
    open(list[(i + delta + list.length) % list.length]);
  }

  function close() {
    playToken += 1;
    destroyHls();
    video.removeAttribute('src');
    video.load();
    root.hidden = true;
    showMsg('');
    exitFullscreen();
    lastFocus?.focus({ preventScroll: true });
  }

  root.addEventListener('click', (e) => {
    wake();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'prev') zap(-1);
    else if (act === 'next') zap(1);
    else if (act === 'alt') { streamIdx = (streamIdx + 1) % current.streams.length; playStream(); }
    else if (act === 'fav') { onToggleFavorite?.(current); renderOsd(); }
    else if (act === 'fs') toggleFullscreen();
  });
  root.addEventListener('mousemove', wake);
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    wake();
    if (KEYS.chUp.has(e.key) || KEYS.chUpCodes.has(e.keyCode)) { e.preventDefault(); zap(1); } // CH+ = chaîne suivante
    else if (KEYS.chDown.has(e.key) || KEYS.chDownCodes.has(e.keyCode)) { e.preventDefault(); zap(-1); }
    else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFullscreen(); }
    else if (KEYS.playPause.has(e.key) || KEYS.playPauseCodes.has(e.keyCode)) {
      e.preventDefault();
      const play = e.key === 'MediaPlay' || e.keyCode === 415 || (e.key !== 'MediaPause' && e.keyCode !== 19 && video.paused);
      if (play) video.play().catch(() => {}); else video.pause();
    }
  });

  return { open, close, root, isOpen: () => !root.hidden, refresh: () => current && renderOsd() };
}
