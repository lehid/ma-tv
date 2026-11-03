// (5) Guide TV : pour chaque chaîne de ma sélection ayant un programme, ce qui passe à l'heure choisie et la suite.
import { header, esc, fmtDate } from './common.js';
import { loadChannels, loadEpg, hhmm, initials } from './data.js';
import { enableTvNav } from './tv-nav.js';

const $ = (id) => document.getElementById(id);
const meta = header('guide.html');
let channels = [];
let epg = {};

/** Minute epoch pour « now » ou une heure « HH:MM » aujourd'hui (demain si déjà passée de plus de 3 h). */
function targetMinute(when) {
  const now = Date.now() / 60000;
  if (when === 'now') return now;
  const [h, m] = when.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  let t = d.getTime() / 60000;
  if (t < now - 180) t += 24 * 60;
  return t;
}

function render() {
  const at = targetMinute($('when').value);
  const words = $('q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [];
  for (const c of channels) {
    const list = epg[c.id] || epg[c.channel];
    if (!list) continue;
    const i = list.findIndex(([, stop]) => stop > at);
    if (i === -1) continue;
    const progs = list.slice(i, i + 6);
    if (words.length) {
      const hay = `${c.name} ${progs.map((p) => p[2]).join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    rows.push(`<div class="epg-row">
      <a class="epg-ch" href="index.html#play=${encodeURIComponent(c.id)}">
        ${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<b>${esc(initials(c.name))}</b>`}
        <span><span class="lcn">${String(c.lcn).padStart(3, '0')}</span> ${esc(c.name)}${c.nsfw ? ' 🔞' : ''}</span>
      </a>
      <div class="epg-progs">${progs.map(([start, stop, title, cat, desc]) => {
        const live = start <= at && at < stop;
        return `<a class="prog${live ? ' live' : ''}" href="index.html#play=${encodeURIComponent(c.id)}" title="${esc(desc)}">
          <time>${hhmm(start)}–${hhmm(stop)}${live && $('when').value === 'now' ? ' · en cours' : ''}</time>
          <strong>${esc(title)}</strong>${cat ? `<small>${esc(cat)}</small>` : ''}</a>`;
      }).join('')}</div>
    </div>`);
  }
  $('rows').innerHTML = rows.join('') || '<p class="empty">Pas de programme disponible. Le guide est mis à jour chaque nuit par l\'action GitHub.</p>';
  $('summary').innerHTML = `<strong>${rows.length}</strong> chaînes avec programme · à ${hhmm(at)}`;
}

async function init() {
  const [data, programmes] = await Promise.all([loadChannels().catch(() => null), loadEpg()]);
  if (!data) { $('summary').textContent = 'Données introuvables : lance « npm run data ».'; return; }
  epg = programmes;
  channels = data.channels.filter((c) => c.mine || c.favorite);
  meta.textContent = `Liste du ${fmtDate(data.generatedAt)}`;
  render();
}

let t;
$('rows').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);
$('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 200); });
$('when').addEventListener('change', render);
// La ligne « en cours » avance toute seule ; on garde l'élément focalisé à la télécommande.
setInterval(() => {
  const focusables = [...$('rows').querySelectorAll('a')];
  const idx = focusables.indexOf(document.activeElement);
  render();
  if (idx !== -1) $('rows').querySelectorAll('a')[idx]?.focus({ preventScroll: true });
}, 60_000);
enableTvNav({ onBack: () => { history.back(); return true; } });
init();
