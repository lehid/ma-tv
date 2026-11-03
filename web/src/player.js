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
      <video playsinline autoplay></video>
      <div class="player-msg" hidden></div>
      <div class="osd">
        <span class="lcn"></span>
        <div><h2></h2><div class="now"></div><div class="progress" hidden><i></i></div></div>
        <div class="osd-actions">
          <button data-act="prev" aria-label="Chaîne précédente">CH− Préc.</button>
          <button data-act="next" aria-label="Chaîne suivante">CH+ Suiv.</button>
          <button data-act="fav">☆ Favori</button>
          <button data-act="alt">Autre flux</button>
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

  function destroyHls() { if (hls) { hls.destroy(); hls = null; } video.onerror = null; }

  async function playStream() {
    destroyHls();
    const token = ++playToken;
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
    const onPlaying = () => showMsg('');
    video.addEventListener('playing', onPlaying, { once: true });
    const Hls = await loadHls();
    if (token !== playToken) return; // l'utilisateur a déjà zappé
    let recovered = false;
    if (Hls.isSupported()) {
      hls = new Hls({ manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 2 });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
        tryNext(data.response?.code ? `Erreur HTTP ${data.response.code}` : 'Flux injoignable (hors ligne, géo-bloqué ou CORS)');
      });
      hls.loadSource(s.url);
      hls.attachMedia(video);
    } else {
      video.src = s.url; // HLS natif
      video.onerror = () => tryNext('Lecture impossible');
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
    root.requestFullscreen?.().catch(() => {});
  }

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
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
  });
  root.addEventListener('mousemove', wake);
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    wake();
    if (KEYS.chUp.has(e.key) || KEYS.chUpCodes.has(e.keyCode)) { e.preventDefault(); zap(1); } // CH+ = chaîne suivante
    else if (KEYS.chDown.has(e.key) || KEYS.chDownCodes.has(e.keyCode)) { e.preventDefault(); zap(-1); }
  });

  return { open, close, root, isOpen: () => !root.hidden, refresh: () => current && renderOsd() };
}
