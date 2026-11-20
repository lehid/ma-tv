// Lecteur plein écran : hls.js (ou HLS natif sur Safari/Tizen/webOS), essais successifs des flux d'une chaîne.
// hls.js (~500 Ko) n'est chargé qu'au premier lancement d'une chaîne.
let HlsPromise;
const loadHls = () => (HlsPromise ||= import('hls.js').then((m) => m.default));
import { nowNext, hhmm } from './data.js';
import { KEYS, arrowDir, isOk, focusEl } from './tv-nav.js';
import { setupAirPlay, setupChromecast } from './cast.js';
import { createTracks } from './tracks.js';
import { prefs } from './store.js';

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createPlayer({ getList, epg = {}, onToggleFavorite }) {
  const root = el(`
    <div class="player" hidden role="dialog" aria-label="Lecteur">
      <video playsinline webkit-playsinline autoplay></video>
      <div class="player-msg" hidden></div>
      <button class="osd-close" data-act="close" aria-label="Fermer le lecteur">Chaînes</button>
      <div class="osd">
        <div class="osd-info">
          <div class="osd-title"><span class="lcn"></span><h2></h2><span class="live-pill">En direct</span></div>
          <div class="now"></div>
          <div class="progress" hidden><i></i></div>
        </div>
        <div class="osd-actions">
          <button data-act="prev" aria-label="Chaîne précédente">Précédente</button>
          <button data-act="next" aria-label="Chaîne suivante">Suivante</button>
          <button data-act="mute">Son</button>
          <button data-track="audio" hidden>Audio</button>
          <button data-track="subs" hidden>Sous-titres</button>
          <button data-act="fav">Favori</button>
          <button data-act="alt">Autre source</button>
          <button data-cast="airplay" hidden>AirPlay</button>
          <button data-cast="chromecast" hidden>Caster</button>
          <button data-act="fs">Plein écran</button>
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
  let userMuted = false; // coupé volontairement (bouton Son ou touche M)
  let autoMuted = false; // coupé par nous parce que le navigateur refusait la lecture avec le son
  const muteBtn = root.querySelector('[data-act="mute"]');
  const tracks = createTracks({
    video, prefs,
    audioBtn: root.querySelector('[data-track="audio"]'),
    subsBtn: root.querySelector('[data-track="subs"]'),
  });

  function updateSound() {
    muteBtn.classList.toggle('primary', autoMuted && video.muted);
    muteBtn.classList.toggle('muted', video.muted);
    muteBtn.textContent = !video.muted ? 'Son' : autoMuted ? 'Activer le son' : 'Son coupé';
  }
  function toggleMute() {
    if (video.muted) { video.muted = false; userMuted = false; autoMuted = false; }
    else { video.muted = true; userMuted = true; }
    updateSound();
  }
  video.addEventListener('volumechange', updateSound);

  // `.player-msg[data-help]` : un panneau d'aide (Cast) est ouvert ; tout autre message l'efface.
  const showMsg = (html) => { delete msg.dataset.resume; delete msg.dataset.help; msg.innerHTML = html; msg.hidden = !html; };
  const isHelpOpen = () => !msg.hidden && msg.dataset.help === '1';
  function showHelp(html) {
    showMsg(html);
    if (!html) return;
    msg.dataset.help = '1';
    wake();
    const btn = msg.querySelector('[data-help-close]');
    if (btn) focusEl(btn); // à la télécommande, OK ferme le panneau
  }
  function closeHelp() {
    if (!isHelpOpen()) return false;
    const hadFocus = msg.contains(document.activeElement);
    showMsg('');
    if (hadFocus) focusEl(root.querySelector('[data-cast="chromecast"]:not([hidden])') || root.querySelector('[data-act="next"]'));
    return true;
  }
  const wake = () => {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add('idle'), 5000);
  };

  function renderOsd() {
    const c = current;
    root.querySelector('.lcn').textContent = String(c.lcn);
    root.querySelector('h2').textContent = c.name;
    const { now, next, progress } = nowNext(epg, c.id);
    const nowEl = root.querySelector('.now');
    nowEl.innerHTML = [
      now && `<div><b>${hhmm(now[0])}–${hhmm(now[1])}</b>${esc(now[2])}</div>`,
      next && `<div>Ensuite · <b>${hhmm(next[0])}</b>${esc(next[2])}</div>`,
    ].filter(Boolean).join('') || `<div>${[c.quality, c.nsfw && 'Adulte (18+)'].filter(Boolean).map(esc).join(' · ')}</div>`;
    if (c.unofficial) nowEl.insertAdjacentHTML('beforeend', '<div class="unofficial">Source non officielle : retransmission par un tiers, peut s\'arrêter à tout moment.</div>');
    const bar = root.querySelector('.progress');
    bar.hidden = !now;
    if (now) bar.firstChild.style.width = `${Math.round(progress * 100)}%`;
    const fav = root.querySelector('[data-act="fav"]');
    fav.classList.toggle('on', !!c.favorite);
    fav.textContent = c.favorite ? 'Dans mes favoris' : 'Favori';
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
    tracks.reset();
    const token = ++playToken;
    const alive = () => token === playToken;
    const s = current.streams[streamIdx];
    if (!s) {
      showMsg(`<strong class="msg-title">Aucun flux lisible ici</strong>Cette chaîne est peut-être hors ligne, géo-bloquée ou refuse les navigateurs.
        Essaie-la dans VLC ou ton appli TV avec la playlist.<span class="msg-hint">Passe à la chaîne précédente ou suivante pour continuer.</span>`);
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
        else showMsg('<strong class="msg-title">Son seulement</strong>Ce flux n\'a pas d\'image lisible sur cet appareil. Essaie-le dans VLC ou ton appli TV.');
      }, NO_PICTURE_CHECK_MS);
    }, { once: true });

    if (hasNativeHls()) {
      video.onerror = () => { if (alive()) tryNext('Lecture impossible'); };
      setTimeout(() => { if (alive() && !started) tryNext('Pas de réponse du flux'); }, NATIVE_TIMEOUT_MS);
      tracks.attachNative();
      video.src = s.url;
    } else {
      const Hls = await loadHls();
      if (!alive()) return; // l'utilisateur a déjà zappé
      if (!Hls.isSupported()) { showMsg('<strong class="msg-title">Ce navigateur ne sait pas lire ces flux</strong>Utilise la playlist dans VLC ou ton appli TV.'); return; }
      video.disableRemotePlayback = true; // exigé par Apple pour ManagedMediaSource
      let recovered = false;
      hls = new Hls({ manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 2 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || !alive()) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
        tryNext(data.response?.code ? `Erreur HTTP ${data.response.code}` : 'Flux injoignable (hors ligne, géo-bloqué ou CORS)');
      });
      tracks.attachHls(hls, Hls);
      hls.loadSource(s.url);
      hls.attachMedia(video);
    }
    video.play().catch((err) => {
      // Seul un refus d'autoplay justifie de couper le son ; AbortError & co. sont des interruptions normales.
      if (err?.name !== 'NotAllowedError' || !alive()) return;
      video.muted = true;
      autoMuted = true;
      updateSound();
      video.play().catch(() => {});
    });
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
    wake();
    // En zappant, le focus reste où il est (Précédente, Suivante…), sauf s'il n'est plus affiché.
    const a = document.activeElement;
    if (!root.contains(a) || !a.getClientRects().length) root.querySelector('[data-act="next"]').focus({ preventScroll: true });
    if (chromecast.isCasting()) { castHere(); return; }
    video.muted = userMuted; // un clic ou une touche : le navigateur autorise le son
    autoMuted = false;
    updateSound();
    playStream();
  }

  // Plein écran : API standard (ordinateur, Android, iPad, TV) sur tout le lecteur pour garder l'OSD ;
  // sur iPhone, seule la <video> peut passer en plein écran (lecteur natif d'iOS).
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const canFsRoot = () => !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const canFsVideo = () => typeof video.webkitEnterFullscreen === 'function';
  const fsBtn = root.querySelector('[data-act="fs"]');

  function updateFsButton() {
    fsBtn.hidden = !canFsRoot() && !canFsVideo();
    fsBtn.textContent = fsElement() ? 'Quitter le plein écran' : 'Plein écran';
  }

  function enterFullscreen() {
    try {
      if (canFsRoot()) {
        const req = root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen();
        Promise.resolve(req).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
      } else if (canFsVideo()) {
        video.webkitEnterFullscreen(); // iPhone : plein écran natif de la vidéo
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
    tracks.reset();
    video.removeAttribute('src');
    video.load();
    root.hidden = true;
    showMsg('');
    exitFullscreen();
    // Focus rendu à la tuile de la chaîne regardée (la grille a pu être redessinée, ex. après « Favori »),
    // sinon à l'élément d'origine.
    let back = null;
    const items = document.querySelectorAll('[data-id]');
    for (let i = 0; i < items.length && !back; i++) if (items[i].dataset.id === current?.id && !root.contains(items[i])) back = items[i];
    if (!back && lastFocus && lastFocus.isConnected) back = lastFocus;
    focusEl(back);
  }

  root.addEventListener('click', (e) => {
    wake();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'prev') zap(-1);
    else if (act === 'next') zap(1);
    else if (act === 'alt') { streamIdx = (streamIdx + 1) % current.streams.length; if (chromecast.isCasting()) castHere(); else playStream(); }
    else if (act === 'fav') { onToggleFavorite?.(current); renderOsd(); }
    else if (act === 'fs') toggleFullscreen();
    else if (act === 'mute') toggleMute();
  });
  // OSD masqué : la première flèche ou OK ne fait que le réafficher (on voit où est le focus avant d'agir).
  root.addEventListener('keydown', (e) => {
    if (!root.classList.contains('idle') || !(arrowDir(e) || isOk(e))) return;
    e.preventDefault();
    e.stopPropagation();
    wake();
  }, true);
  root.addEventListener('mousemove', wake);
  root.addEventListener('touchstart', wake, { passive: true });

  // Sortie du plein écran : iOS met la vidéo en pause en quittant son lecteur natif, parfois APRÈS
  // l'évènement de sortie. On ouvre une courte fenêtre pendant laquelle toute pause est annulée,
  // sauf si l'utilisateur avait lui-même mis en pause dans le plein écran (pause bien avant la sortie).
  const RESUME_WINDOW_MS = 1500;
  const USER_PAUSE_MARGIN_MS = 1000;
  let resumeUntil = 0;
  let resumeToken = -1;
  let lastPauseAt = 0;

  function resumeNow() {
    if (root.hidden || resumeToken !== playToken || chromecast.isCasting() || !video.paused) return;
    video.play().then(() => { if (msg.dataset.resume) showMsg(''); }).catch((err) => {
      if (err?.name !== 'NotAllowedError' || resumeToken !== playToken) return;
      // iOS refuse une reprise sans geste : un bouton évite l'écran figé.
      showMsg('<button type="button" data-resume class="primary">Reprendre la lecture</button>');
      msg.dataset.resume = '1';
    });
  }

  const resumeAfterFullscreen = () => {
    if (root.hidden) return;
    wake();
    updateFsButton();
    const sincePause = Date.now() - lastPauseAt;
    if (video.paused && sincePause > USER_PAUSE_MARGIN_MS) return; // pause volontaire : on la respecte
    resumeToken = playToken;
    resumeUntil = Date.now() + RESUME_WINDOW_MS;
    resumeNow();
    setTimeout(resumeNow, 250);
    setTimeout(resumeNow, 800);
  };
  video.addEventListener('pause', () => {
    lastPauseAt = Date.now();
    if (Date.now() < resumeUntil) resumeNow(); // pause automatique d'iOS juste après la sortie
  });
  msg.addEventListener('click', (e) => {
    if (e.target.closest('[data-help-close]')) { e.stopPropagation(); closeHelp(); return; }
    if (!e.target.closest('[data-resume]')) return;
    e.stopPropagation();
    delete msg.dataset.resume;
    showMsg('');
    video.play().catch(() => {});
  });
  video.addEventListener('webkitendfullscreen', resumeAfterFullscreen);
  const onFsChange = () => { if (!fsElement()) resumeAfterFullscreen(); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // Diffusion vers la TV : AirPlay (Safari) et Chromecast (Chrome).
  setupAirPlay(video, root.querySelector('[data-cast="airplay"]'));
  let castDevice = '';
  function castHere() {
    playToken += 1; // annule les essais et minuteurs de lecture locale
    destroyHls();
    video.pause();
    showMsg(`Diffusion de <strong>${esc(current.name)}</strong> sur <strong>${esc(castDevice)}</strong>.<br>CH+ / CH− pour changer de chaîne sur la TV.`);
    chromecast.castCurrent();
  }
  const chromecast = setupChromecast(root.querySelector('[data-cast="chromecast"]'), {
    getMedia: () => {
      if (!current) return null;
      // La TV ne lit pas le http:// depuis le récepteur https : on prend le premier flux https.
      const s = current.streams.slice(streamIdx).concat(current.streams.slice(0, streamIdx)).find((x) => x.url.startsWith('https:'));
      return s && { url: s.url, title: current.name, subtitle: 'Ma TV', image: current.logo };
    },
    onStart: (name) => { castDevice = name; if (current && !root.hidden) castHere(); },
    onEnd: () => { if (current && !root.hidden) playStream(); },
    onError: (e) => showMsg(e?.message === 'no-https'
      ? `<strong class="msg-title">${esc(current?.name || 'Cette chaîne')} ne peut pas être diffusée</strong>Elle n'a pas de flux sécurisé (https), seul format accepté par Chromecast. Essaie une autre chaîne.`
      : e?.message === 'timeout'
        ? `<strong class="msg-title">La TV ne répond pas pour ${esc(current?.name || 'ce flux')}</strong>Le flux met trop de temps à démarrer. Essaie « Autre source » ou une autre chaîne.`
        : `<strong class="msg-title">La TV n'a pas pu lire ${esc(current?.name || 'ce flux')}</strong>Certains flux refusent la diffusion. Essaie « Autre source » ou une autre chaîne.`),
    onHelp: (html) => showHelp(html),
  });
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    wake();
    if (KEYS.chUp.has(e.key) || KEYS.chUpCodes.has(e.keyCode)) { e.preventDefault(); zap(1); } // CH+ = chaîne suivante
    else if (KEYS.chDown.has(e.key) || KEYS.chDownCodes.has(e.keyCode)) { e.preventDefault(); zap(-1); }
    else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleMute(); }
    else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFullscreen(); }
    else if (KEYS.playPause.has(e.key) || KEYS.playPauseCodes.has(e.keyCode)) {
      e.preventDefault();
      const play = e.key === 'MediaPlay' || e.keyCode === 415 || (e.key !== 'MediaPause' && e.keyCode !== 19 && video.paused);
      if (play) video.play().catch(() => {}); else video.pause();
    }
  });

  /** Retour : ferme d'abord le panneau d'aide, sinon le lecteur. Renvoie true si quelque chose a été fermé. */
  function back() {
    if (root.hidden) return false;
    if (closeHelp()) return true;
    close();
    return true;
  }

  return { open, close, back, root, isOpen: () => !root.hidden, refresh: () => current && renderOsd() };
}
