// (1) Page « Chaînes » : catégories en pastilles, grille de tuiles, lecteur, saisie de numéro à la télécommande.
import { header, esc, fmtDate, hashParams, setHash } from './common.js';
import { loadChannels, loadEpg, nowNext, channelsToM3U } from './data.js';
import { categoryLabel, FAVORITES_GROUP, NSFW_GROUP } from './labels.js';
import { createPlayer } from './player.js';
import { enableTvNav } from './tv-nav.js';
import { prefs } from './store.js';

const PAGE = 120;
const $ = (id) => document.getElementById(id);
const meta = header('index.html');
const ui = { q: $('q'), country: $('country'), lang: $('lang'), nsfw: $('nsfw'), alive: $('alive') };
// cat : '' (tout), 'favs' (favoris) ou un id de catégorie iptv-org.
const state = { scope: 'mine', cat: '', shown: PAGE };
let data;
let epg = {};
let filtered = [];

// Titres de section sans émoji (les groupes M3U gardent leur libellé d'origine pour les applis IPTV).
const sectionTitle = (g) => (g === FAVORITES_GROUP ? 'Favoris' : g === NSFW_GROUP ? 'Adulte (18+)' : g);

function inScope(c) {
  if (state.scope === 'mine' && !c.mine && !c.favorite) return false;
  if (ui.nsfw.value === 'hide' && c.nsfw) return false;
  if (ui.nsfw.value === 'only' && !c.nsfw) return false;
  if (ui.country.value && c.country !== ui.country.value) return false;
  if (ui.lang.value && !c.languages.includes(ui.lang.value)) return false;
  if (ui.alive.value === 'ok' && c.status !== 'ok') return false;
  if (ui.alive.value === 'nogeo' && c.geo) return false;
  return true;
}

function applyFilters() {
  const q = ui.q.value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const base = data.channels.filter(inScope);
  renderChips(base);
  filtered = base.filter((c) => {
    if (state.cat === 'favs' && !c.favorite) return false;
    if (state.cat && state.cat !== 'favs' && !c.categories.includes(state.cat)) return false;
    if (words.length) {
      const hay = `${c.name} ${c.channel} ${data.countries[c.country]?.[0] || ''} ${c.categories.map(categoryLabel).join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const { play, ...rest } = Object.fromEntries(hashParams());
  setHash({ ...rest, q, pays: ui.country.value, cat: state.cat, langue: ui.lang.value, liste: state.scope === 'mine' ? '' : state.scope, play });
  prefs.set('filters', { nsfw: ui.nsfw.value, alive: ui.alive.value, scope: state.scope });
}

/** Pastilles : Tout, Favoris, puis les catégories présentes dans la liste en cours, de la plus fournie à la moins fournie. */
function renderChips(base) {
  const count = new Map();
  for (const c of base) for (const cat of c.categories) if (cat !== 'xxx') count.set(cat, (count.get(cat) || 0) + 1);
  const cats = [...count].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  if (state.cat && state.cat !== 'favs' && !cats.includes(state.cat)) cats.unshift(state.cat);
  const favCount = base.filter((c) => c.favorite).length;
  const chip = (v, label, extra = '') => `<button type="button" class="chip" data-cat="${esc(v)}" aria-pressed="${state.cat === v}">${extra}${esc(label)}</button>`;
  const html = [chip('', 'Tout'), favCount ? chip('favs', 'Favoris', '<span class="i i-star" aria-hidden="true"></span>') : '']
    .concat(cats.map((c) => chip(c, categoryLabel(c)))).join('');
  if ($('chips').innerHTML !== html) {
    const focused = document.activeElement?.closest?.('.chip')?.dataset.cat;
    $('chips').innerHTML = html;
    if (focused !== undefined) $('chips').querySelector(`[data-cat="${CSS.escape ? CSS.escape(focused) : focused}"]`)?.focus({ preventScroll: true });
  }
}

function tile(c) {
  const [cname] = data.countries[c.country] || [''];
  const { now, progress } = nowNext(epg, c.id);
  const off = c.status === 'ko';
  const sub = off ? 'Hors ligne au dernier contrôle'
    : now ? `<span class="live">En direct</span>${esc(now[2])}` : esc(cname);
  return `<button type="button" class="tile${off ? ' off' : ''}" data-id="${esc(c.id)}">
    <span class="plate">
      ${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="plate-name">${esc(c.name)}</span>`}
      ${c.nsfw ? '<span class="adult" title="Contenu adulte">18+</span>' : ''}
      ${c.favorite ? '<span class="fav i i-star" aria-label="Favori"></span>' : ''}
      ${now ? `<span class="pbar"><i style="width:${Math.round(progress * 100)}%"></i></span>` : ''}
    </span>
    <span class="tile-line"><span class="num">${c.lcn}</span><span class="tile-name">${esc(c.name)}</span></span>
    <span class="tile-sub">${sub}</span>
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
  // Une seule catégorie choisie : pas besoin de titres de section.
  const single = state.cat && state.cat !== 'favs';
  $('list').innerHTML = sorted.length
    ? (single ? `<div class="grid">${slice.map(tile).join('')}</div>`
      : sorted.map(([g, list]) => `<h2 class="section-title">${esc(sectionTitle(g))} <small>${list.length}</small></h2><div class="grid">${list.map(tile).join('')}</div>`).join(''))
    : '<p class="empty">Aucune chaîne ne correspond. Élargis la recherche, ou passe la liste sur « Monde » dans Filtres.</p>';
  const scopeLabel = state.scope === 'mine' ? 'ma sélection' : 'monde entier';
  $('summary').textContent = `${filtered.length.toLocaleString('fr-FR')} chaînes · ${scopeLabel}`;
  $('more').hidden = filtered.length <= state.shown;
  $('more').textContent = `Afficher plus (${(filtered.length - state.shown).toLocaleString('fr-FR')} restantes)`;
}

const refresh = () => { state.shown = PAGE; applyFilters(); render(); };

function fillSelect(sel, entries) {
  sel.insertAdjacentHTML('beforeend', entries.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join(''));
}

function setScope(scope) {
  state.scope = scope === 'world' ? 'world' : 'mine';
  for (const b of $('scope').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === state.scope));
}

// Saisie d'un numéro de chaîne (comme sur un décodeur) : chiffres puis 1,5 s d'attente.
let dialBuf = '';
let dialTimer;
function dial(digit) {
  dialBuf = (dialBuf + digit).slice(-4);
  $('dial').hidden = false;
  $('dial').textContent = dialBuf;
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
  meta.textContent = `Mis à jour le ${fmtDate(data.checkedAt || data.generatedAt)}`;

  const present = (key) => {
    const count = new Map();
    for (const c of data.channels) for (const v of [].concat(c[key])) count.set(v, (count.get(v) || 0) + 1);
    return count;
  };
  const cCount = present('country');
  fillSelect(ui.country, [...cCount.keys()].filter((k) => data.countries[k])
    .map((k) => [k, data.countries[k][0]])
    .sort((a, b) => a[1].localeCompare(b[1], 'fr')));
  const lCount = present('languages');
  fillSelect(ui.lang, [...lCount].filter(([k]) => data.languages[k]).sort((a, b) => b[1] - a[1]).slice(0, 80)
    .map(([k]) => [k, data.languages[k]]));

  const saved = prefs.get('filters', {});
  const h = hashParams();
  ui.nsfw.value = saved.nsfw || 'show';
  ui.alive.value = saved.alive || '';
  ui.q.value = h.get('q') || '';
  ui.country.value = h.get('pays') || '';
  ui.lang.value = h.get('langue') || '';
  state.cat = h.get('cat') || (h.get('liste') === 'favs' ? 'favs' : '');
  setScope(h.get('liste') || saved.scope || 'mine');
  // Filtres avancés actifs : on ouvre le panneau pour qu'ils restent visibles.
  if (ui.lang.value || ui.alive.value || ui.nsfw.value !== 'show' || state.scope === 'world') $('more-filters').open = true;

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
for (const k of ['country', 'lang', 'nsfw', 'alive']) ui[k].addEventListener('change', refresh);
$('scope').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) { setScope(v); refresh(); } });
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.cat = b.dataset.cat;
  refresh();
});
// Logo cassé → nom de la chaîne dans la plaque.
$('list').addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG') return;
  const name = e.target.closest('.tile')?.querySelector('.tile-name')?.textContent || '';
  e.target.replaceWith(Object.assign(document.createElement('span'), { className: 'plate-name', textContent: name }));
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
