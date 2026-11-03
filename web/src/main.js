// (1) Page « Chaînes » : grille filtrable + lecteur + saisie de numéro à la télécommande.
import { header, esc, fmtDate, hashParams, setHash } from './common.js';
import { loadChannels, loadEpg, nowNext, initials, channelsToM3U } from './data.js';
import { categoryLabel, FAVORITES_GROUP, NSFW_GROUP } from './labels.js';
import { createPlayer } from './player.js';
import { enableTvNav } from './tv-nav.js';
import { prefs } from './store.js';

const PAGE = 120;
const $ = (id) => document.getElementById(id);
const meta = header('index.html');
const ui = { q: $('q'), country: $('country'), cat: $('cat'), lang: $('lang'), nsfw: $('nsfw'), alive: $('alive') };
let state = { scope: 'mine', shown: PAGE };
let data;
let epg = {};
let filtered = [];

function readFilters() {
  return {
    q: ui.q.value.trim().toLowerCase(), country: ui.country.value, cat: ui.cat.value, lang: ui.lang.value,
    nsfw: ui.nsfw.value, alive: ui.alive.value, scope: state.scope,
  };
}

function applyFilters() {
  const f = readFilters();
  const words = f.q.split(/\s+/).filter(Boolean);
  filtered = data.channels.filter((c) => {
    if (f.scope === 'mine' && !c.mine && !c.favorite) return false;
    if (f.scope === 'favs' && !c.favorite) return false;
    if (f.nsfw === 'hide' && c.nsfw) return false;
    if (f.nsfw === 'only' && !c.nsfw) return false;
    if (f.country && c.country !== f.country) return false;
    if (f.cat && !c.categories.includes(f.cat)) return false;
    if (f.lang && !c.languages.includes(f.lang)) return false;
    if (f.alive === 'ok' && c.status !== 'ok') return false;
    if (f.alive === 'nogeo' && c.geo) return false;
    if (words.length) {
      const hay = `${c.name} ${c.channel} ${data.countries[c.country]?.[0] || ''} ${c.categories.map(categoryLabel).join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const { play, ...rest } = Object.fromEntries(hashParams());
  setHash({ ...rest, q: f.q, pays: f.country, cat: f.cat, langue: f.lang, liste: f.scope === 'mine' ? '' : f.scope, play });
  prefs.set('filters', { nsfw: f.nsfw, alive: f.alive, scope: f.scope });
}

function tile(c) {
  const [cname, flag] = data.countries[c.country] || ['', ''];
  const { now } = nowNext(epg, c.id);
  const badges = [
    c.nsfw && '<span class="badge nsfw" title="Contenu adulte">🔞 18+</span>',
    c.quality && `<span class="badge">${esc(c.quality)}</span>`,
    c.geo && '<span class="badge geo" title="Peut être bloqué hors du pays">géo</span>',
    c.streams.length > 1 && `<span class="badge" title="Flux alternatifs">×${c.streams.length}</span>`,
  ].filter(Boolean).join('');
  const dot = c.status ? `<span class="dot ${c.status}" title="${c.status === 'ok' ? 'En ligne au dernier contrôle' : 'Hors ligne au dernier contrôle'}"></span>` : '<span class="dot" title="Non vérifié"></span>';
  return `<button type="button" class="tile" data-id="${esc(c.id)}">
    <span class="tile-head"><span class="lcn">${String(c.lcn).padStart(3, '0')}</span>${dot}</span>
    <span class="logo">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="initials">${esc(initials(c.name))}</span>`}</span>
    <span class="tile-name">${esc(c.name)}</span>
    <span class="tile-sub">${now ? `▶ ${esc(now[2])}` : `${esc(flag)} ${esc(cname)}`}</span>
    ${badges ? `<span class="badges">${badges}</span>` : ''}
    ${c.favorite ? '<span class="fav" aria-label="Favori">★</span>' : ''}
  </button>`;
}

function render() {
  const slice = filtered.slice(0, state.shown);
  const groups = new Map();
  for (const c of slice) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  const sorted = [...groups].sort(([a], [b]) => (a === FAVORITES_GROUP ? -1 : b === FAVORITES_GROUP ? 1 : a === NSFW_GROUP ? 1 : b === NSFW_GROUP ? -1 : 0));
  $('list').innerHTML = sorted.length
    ? sorted.map(([g, list]) => `<h2 class="section-title">${esc(g)} <small>${list.length}</small></h2><div class="grid">${list.map(tile).join('')}</div>`).join('')
    : '<p class="empty">Aucune chaîne ne correspond. Élargis les filtres ou passe en « Monde ».</p>';
  const nsfwCount = filtered.filter((c) => c.nsfw).length;
  $('summary').innerHTML = `<strong>${filtered.length.toLocaleString('fr-FR')}</strong> chaînes`
    + (nsfwCount ? ` · <strong>${nsfwCount}</strong> taguées 🔞` : '')
    + ` · tape un numéro à la télécommande pour zapper`;
  $('more').hidden = filtered.length <= state.shown;
  $('more').textContent = `Afficher plus (${(filtered.length - state.shown).toLocaleString('fr-FR')} restantes)`;
}

const refresh = () => { state.shown = PAGE; applyFilters(); render(); };

function fillSelect(sel, entries) {
  sel.insertAdjacentHTML('beforeend', entries.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join(''));
}

function setScope(scope) {
  state.scope = scope;
  for (const b of $('scope').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === scope));
}

// Saisie d'un numéro de chaîne (comme sur un décodeur) : chiffres puis 1,5 s d'attente.
let dialBuf = '';
let dialTimer;
function dial(digit) {
  dialBuf = (dialBuf + digit).slice(-4);
  $('dial').hidden = false;
  $('dial').textContent = dialBuf.padStart(3, '-');
  clearTimeout(dialTimer);
  dialTimer = setTimeout(() => {
    const ch = data.channels.find((c) => c.lcn === Number(dialBuf));
    $('dial').hidden = true;
    dialBuf = '';
    if (ch) player.open(ch);
  }, 1500);
}

let player;

async function init() {
  try {
    data = await loadChannels();
  } catch (e) {
    $('summary').textContent = e.message;
    return;
  }
  epg = await loadEpg();
  meta.textContent = `Liste du ${fmtDate(data.generatedAt)}${data.checkedAt ? ` · vérifiée le ${fmtDate(data.checkedAt)}` : ''}`;

  const present = (key) => {
    const count = new Map();
    for (const c of data.channels) for (const v of [].concat(c[key])) count.set(v, (count.get(v) || 0) + 1);
    return count;
  };
  const cCount = present('country');
  fillSelect(ui.country, [...cCount.keys()].filter((k) => data.countries[k])
    .map((k) => [k, `${data.countries[k][1]} ${data.countries[k][0]} (${cCount.get(k)})`])
    .sort((a, b) => a[1].slice(3).localeCompare(b[1].slice(3), 'fr')));
  fillSelect(ui.cat, data.categories.map((c) => [c, categoryLabel(c)]).sort((a, b) => a[1].localeCompare(b[1], 'fr')));
  const lCount = present('languages');
  fillSelect(ui.lang, [...lCount].filter(([k]) => data.languages[k]).sort((a, b) => b[1] - a[1]).slice(0, 80)
    .map(([k, n]) => [k, `${data.languages[k]} (${n})`]));

  const saved = prefs.get('filters', {});
  const h = hashParams();
  ui.nsfw.value = saved.nsfw || 'show';
  ui.alive.value = saved.alive || '';
  ui.q.value = h.get('q') || '';
  ui.country.value = h.get('pays') || '';
  ui.cat.value = h.get('cat') || '';
  ui.lang.value = h.get('langue') || '';
  setScope(h.get('liste') || saved.scope || 'mine');

  player = createPlayer({
    getList: () => filtered,
    epg,
    onToggleFavorite: (c) => {
      const on = prefs.setFavorite(c.channel, !c.favorite);
      for (const x of data.channels) if (x.channel === c.channel) x.favorite = on;
      render();
    },
  });

  refresh();
  const toPlay = h.get('play') && data.channels.find((c) => c.id === h.get('play') || c.channel === h.get('play'));
  if (toPlay) player.open(toPlay);
}

// Évènements
let qTimer;
ui.q.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(refresh, 200); });
for (const k of ['country', 'cat', 'lang', 'nsfw', 'alive']) ui[k].addEventListener('change', refresh);
$('scope').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) { setScope(v); refresh(); } });
// Logo cassé → initiales.
$('list').addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG') return;
  const name = e.target.closest('.tile')?.querySelector('.tile-name')?.textContent || '';
  e.target.replaceWith(Object.assign(document.createElement('span'), { className: 'initials', textContent: initials(name) }));
}, true);
$('more').addEventListener('click', () => {
  const firstNew = state.shown;
  state.shown += PAGE * 2;
  render();
  document.querySelectorAll('.tile')[firstNew]?.focus();
});
$('list').addEventListener('click', (e) => {
  const id = e.target.closest('.tile')?.dataset.id;
  if (id) player.open(data.channels.find((c) => c.id === id));
});
$('download').addEventListener('click', () => {
  const blob = new Blob([channelsToM3U(filtered)], { type: 'audio/x-mpegurl' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'ma-selection.m3u' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
document.addEventListener('keydown', (e) => {
  if (!data || e.target.matches('input, select')) return;
  const digit = /^[0-9]$/.test(e.key) ? e.key : e.keyCode >= 48 && e.keyCode <= 57 ? String(e.keyCode - 48) : null;
  if (digit) dial(digit);
});

enableTvNav({
  getScope: () => (player?.isOpen() ? player.root : document),
  onBack: () => { if (player?.isOpen()) { player.close(); return true; } return false; },
});

init();
