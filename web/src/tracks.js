// Pistes audio et sous-titres, avec la même interface pour les deux moteurs de lecture :
// - hls.js (Chrome, Firefox, Edge, TV) : hls.audioTracks / hls.subtitleTracks, plus les sous-titres
//   codés dans la vidéo (CEA-608) qu'hls.js expose comme pistes texte « captions » ;
// - HLS natif (Safari) : video.audioTracks et video.textTracks.
// Les boutons n'apparaissent que si le flux propose un choix. Chaque appui passe à l'option suivante :
// un seul bouton, facile à utiliser avec OK à la télécommande.

let displayNames = null;
try { displayNames = new Intl.DisplayNames(['fr'], { type: 'language' }); } catch (e) { /* navigateur ancien */ }

function langLabel(lang, name) {
  const code = (lang || '').trim();
  let label = '';
  if (code && displayNames) {
    try { label = displayNames.of(code) || ''; } catch (e) { label = ''; }
  }
  if (!label || label.toLowerCase() === code.toLowerCase()) label = name || code || '';
  label = label || 'Piste';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const isTextTrack = (t) => t.kind === 'subtitles' || t.kind === 'captions';

/**
 * `audioBtn` / `subsBtn` : boutons de l'OSD. `prefs` : magasin de préférences (web/src/store.js).
 * Renvoie { attachHls(hls, Hls), attachNative(), reset(), cycleAudio(), cycleSubs() }.
 */
export function createTracks({ video, audioBtn, subsBtn, prefs }) {
  let engine = null; // 'hls' | 'native' | null
  let hls = null;
  let appliedAudio = false;
  let appliedSubs = false;

  // ---- Audio ----
  function audioList() {
    if (engine === 'hls' && hls) {
      return { items: hls.audioTracks.map((t) => ({ lang: t.lang, label: langLabel(t.lang, t.name) })), current: hls.audioTrack };
    }
    if (engine === 'native' && video.audioTracks) {
      const tracks = Array.from(video.audioTracks);
      return { items: tracks.map((t) => ({ lang: t.language, label: langLabel(t.language, t.label) })), current: tracks.findIndex((t) => t.enabled) };
    }
    return { items: [], current: -1 };
  }

  function selectAudio(i) {
    if (engine === 'hls' && hls) hls.audioTrack = i;
    else if (engine === 'native' && video.audioTracks) Array.from(video.audioTracks).forEach((t, j) => { t.enabled = j === i; });
  }

  // ---- Sous-titres : liste d'options { label, lang, apply() } ; l'option « Non » est gérée à part ----
  function subsOptions() {
    const opts = [];
    if (engine === 'hls' && hls) {
      hls.subtitleTracks.forEach((t, i) => opts.push({
        lang: t.lang, label: langLabel(t.lang, t.name), hlsIndex: i,
      }));
      // Sous-titres codés dans la vidéo (CEA-608/708), créés par hls.js dans video.textTracks.
      Array.from(video.textTracks).forEach((t) => {
        if (t.kind === 'captions' && !opts.some((o) => o.track === t)) {
          opts.push({ lang: t.language, label: `${langLabel(t.language, t.label)} (codés)`, track: t });
        }
      });
    } else if (engine === 'native') {
      Array.from(video.textTracks).filter(isTextTrack).forEach((t) => opts.push({ lang: t.language, label: langLabel(t.language, t.label), track: t }));
    }
    return opts;
  }

  function currentSub(opts) {
    if (engine === 'hls' && hls && hls.subtitleTrack >= 0 && hls.subtitleDisplay !== false) {
      const i = opts.findIndex((o) => o.hlsIndex === hls.subtitleTrack);
      if (i !== -1) return i;
    }
    return opts.findIndex((o) => o.track && o.track.mode === 'showing');
  }

  function selectSub(opts, i) {
    // Tout éteindre, puis allumer l'option choisie (i = -1 : sous-titres désactivés).
    if (engine === 'hls' && hls) { hls.subtitleTrack = -1; }
    Array.from(video.textTracks).forEach((t) => { if (isTextTrack(t)) t.mode = 'disabled'; });
    const o = opts[i];
    if (!o) return;
    if (o.hlsIndex !== undefined) { hls.subtitleDisplay = true; hls.subtitleTrack = o.hlsIndex; }
    else if (o.track) o.track.mode = 'showing';
  }

  // ---- Boutons ----
  function render() {
    const a = audioList();
    audioBtn.hidden = a.items.length < 2;
    if (!audioBtn.hidden) audioBtn.textContent = `🔈 Audio : ${a.items[a.current]?.label || '—'}`;
    const opts = subsOptions();
    subsBtn.hidden = opts.length === 0;
    if (!subsBtn.hidden) {
      const i = currentSub(opts);
      subsBtn.textContent = `CC Sous-titres : ${i === -1 ? 'Non' : opts[i].label}`;
    }
  }

  // Réapplique la dernière langue choisie par l'utilisateur, une fois par flux, si elle existe.
  function applyPrefs() {
    const a = audioList();
    const wantAudio = prefs.get('audioLang', '');
    if (!appliedAudio && a.items.length > 1) {
      appliedAudio = true;
      const i = a.items.findIndex((t) => t.lang && t.lang === wantAudio);
      if (wantAudio && i !== -1 && i !== a.current) selectAudio(i);
    }
    const opts = subsOptions();
    const wantSubs = prefs.get('subsLang', 'off');
    if (!appliedSubs && opts.length) {
      appliedSubs = true;
      const i = wantSubs === 'off' ? -1 : opts.findIndex((o) => o.lang === wantSubs);
      if (i !== -1 || wantSubs === 'off') selectSub(opts, i);
    }
  }

  function refresh() {
    if (!engine) return;
    applyPrefs();
    render();
  }

  function cycleAudio() {
    const a = audioList();
    if (a.items.length < 2) return;
    const next = (a.current + 1) % a.items.length;
    selectAudio(next);
    prefs.set('audioLang', a.items[next].lang || '');
    setTimeout(render, 50);
  }

  function cycleSubs() {
    const opts = subsOptions();
    if (!opts.length) return;
    const cur = currentSub(opts);
    const next = cur + 1 >= opts.length ? -1 : cur + 1; // … → dernière piste → Non → première piste
    selectSub(opts, next);
    prefs.set('subsLang', next === -1 ? 'off' : opts[next].lang || 'off');
    setTimeout(render, 50);
  }

  // Les pistes texte et audio peuvent apparaître en cours de lecture.
  video.textTracks.addEventListener?.('addtrack', refresh);
  video.textTracks.addEventListener?.('removetrack', refresh);
  video.textTracks.addEventListener?.('change', render);
  video.audioTracks?.addEventListener?.('addtrack', refresh);
  video.audioTracks?.addEventListener?.('change', render);
  video.addEventListener('loadedmetadata', refresh);

  function reset() {
    engine = null;
    hls = null;
    appliedAudio = false;
    appliedSubs = false;
    audioBtn.hidden = true;
    subsBtn.hidden = true;
    Array.from(video.textTracks).forEach((t) => { if (isTextTrack(t)) t.mode = 'disabled'; });
  }

  function attachHls(instance, Hls) {
    reset();
    engine = 'hls';
    hls = instance;
    hls.subtitleDisplay = true;
    const E = Hls.Events;
    [E.MANIFEST_PARSED, E.AUDIO_TRACKS_UPDATED, E.SUBTITLE_TRACKS_UPDATED].forEach((ev) => hls.on(ev, () => setTimeout(refresh, 0)));
    [E.AUDIO_TRACK_SWITCHED, E.SUBTITLE_TRACK_SWITCH].forEach((ev) => hls.on(ev, () => setTimeout(render, 0)));
  }

  function attachNative() {
    reset();
    engine = 'native';
  }

  audioBtn.addEventListener('click', cycleAudio);
  subsBtn.addEventListener('click', cycleSubs);

  return { attachHls, attachNative, reset, cycleAudio, cycleSubs, refresh };
}
