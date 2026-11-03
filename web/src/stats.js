// (3) Page stats : carte choroplèthe (échelle log, une teinte) + barres horizontales.
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import isoNumeric from './iso-numeric.json';
import { header, esc, fmtDate } from './common.js';
import { categoryLabel } from './labels.js';
import { enableTvNav } from './tv-nav.js';

const $ = (id) => document.getElementById(id);
const meta = header('stats.html');
const fmt = (n) => n.toLocaleString('fr-FR');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpColor(a, b, t) {
  const [A, B] = [hexToRgb(a), hexToRgb(b)];
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}

function bars(el, rows, { href } = {}) {
  const max = Math.max(...rows.map(([, n]) => n));
  el.innerHTML = rows.map(([label, n, key]) => {
    const tag = href ? 'a' : 'div';
    return `<${tag} class="bar"${href ? ` href="${href(key ?? label)}"` : ''} title="${esc(label)} : ${fmt(n)}">
      <span class="lbl">${esc(label)}</span>
      <span class="track"><span class="fill" style="width:${Math.max(0.5, (n / max) * 100)}%"></span></span>
      <span class="val">${fmt(n)}</span></${tag}>`;
  }).join('');
}

function drawMap(stats, countries) {
  const wrap = $('map');
  const W = 960;
  const H = 470;
  const geo = feature(world, world.objects.countries);
  geo.features = geo.features.filter((f) => f.id !== '010'); // sans l'Antarctique
  const numToAlpha = Object.fromEntries(Object.entries(isoNumeric).map(([a, n]) => [n, a]));
  const projection = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], geo);
  const path = geoPath(projection);
  const values = Object.values(stats.byCountry);
  const maxLog = Math.log10(Math.max(...values) + 1);
  const color = (n) => (n ? lerpColor(css('--seq-lo'), css('--seq-hi'), Math.log10(n + 1) / maxLog) : css('--nodata'));
  const shapes = geo.features.map((f) => {
    const cc = numToAlpha[f.id] === 'GB' ? 'UK' : numToAlpha[f.id];
    const n = stats.byCountry[cc] || 0;
    const name = countries[cc]?.name || f.properties.name;
    return `<path d="${path(f)}" fill="${color(n)}" data-cc="${cc || ''}" data-n="${n}" data-name="${esc(name)}"${n ? ' tabindex="0" role="link"' : ''}><title>${esc(name)} : ${fmt(n)} chaînes</title></path>`;
  }).join('');
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="stroke:var(--bg);stroke-width:0.5">${shapes}</svg>`;
  // Légende : rampe continue + bornes réelles.
  $('legend').innerHTML = `<span>1</span><span class="ramp" style="background:linear-gradient(90deg, ${css('--seq-lo')}, ${css('--seq-hi')})"></span><span>${fmt(Math.max(...values))} chaînes (échelle log)</span>`;

  const tip = $('tip');
  wrap.addEventListener('mousemove', (e) => {
    const p = e.target.closest('path');
    if (!p) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.innerHTML = `<strong>${esc(p.dataset.name)}</strong> · ${fmt(+p.dataset.n)} chaînes`;
    tip.style.left = `${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  wrap.addEventListener('mouseleave', () => { tip.hidden = true; });
  const go = (p) => { if (p?.dataset.cc && +p.dataset.n) location.href = `index.html#pays=${p.dataset.cc}&liste=world`; };
  wrap.addEventListener('click', (e) => go(e.target.closest('path')));
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.target.closest('path')); });
}

async function init() {
  const base = import.meta.env.BASE_URL;
  const [stats, channels] = await Promise.all([
    fetch(`${base}data/stats.json`).then((r) => r.json()).catch(() => null),
    fetch(`${base}data/channels.json`).then((r) => r.json()).catch(() => null),
  ]);
  if (!stats) { $('kpis').textContent = 'stats.json introuvable : lance « npm run stats ».'; return; }
  const countries = Object.fromEntries(Object.entries(channels?.countries || {}).map(([cc, [name, flag]]) => [cc, { name, flag }]));
  meta.textContent = `Données du ${fmtDate(stats.generatedAt)}`;
  const t = stats.totals;
  const kpis = [
    [fmt(t.channels), 'chaînes'], [fmt(t.streams), 'flux'], [fmt(t.countries), 'pays'],
    [`${Math.round((t.geoBlocked / t.streams) * 100)} %`, 'flux géo-bloqués'],
    [fmt(t.nsfwChannels), 'chaînes taguées 🔞'],
  ];
  if (stats.health) kpis.push([`${Math.round((stats.health.ok / stats.health.checked) * 100)} %`, `de ma sélection en ligne (${fmtDate(stats.health.checkedAt)})`]);
  $('kpis').innerHTML = kpis.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('');

  drawMap(stats, countries);
  bars($('countries'), Object.entries(stats.byCountry).slice(0, 15).map(([cc, n]) => [`${countries[cc]?.flag || ''} ${countries[cc]?.name || cc}`, n, cc]),
    { href: (cc) => `index.html#pays=${cc}&liste=world` });
  bars($('cats'), Object.entries(stats.byCategory).map(([c, n]) => [categoryLabel(c), n, c]), { href: (c) => `index.html#cat=${c}&liste=world` });
  bars($('langs'), stats.byLanguage);
  const order = ['4K', '1080p', '720p', 'SD (< 720p)', 'Inconnue'];
  bars($('quality'), order.filter((q) => stats.byQuality[q]).map((q) => [q, stats.byQuality[q]]));

  // Les couleurs de la carte dépendent du thème : on redessine si le thème change.
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => drawMap(stats, countries));
}

enableTvNav({ onBack: () => { history.back(); return true; } });
init();
