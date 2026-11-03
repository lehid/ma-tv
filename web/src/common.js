import './style.css';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PAGES = [['index.html', 'Chaînes'], ['guide.html', 'Guide TV'], ['stats.html', 'Stats']];

/** En-tête commun avec navigation ; `active` = nom du fichier de la page. */
export function header(active, metaText = '') {
  const h = document.createElement('header');
  h.className = 'top';
  h.innerHTML = `
    <div class="brand"><span class="onair" aria-hidden="true"></span>Ma TV</div>
    <nav class="nav">${PAGES.map(([href, label]) => `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div class="meta">${esc(metaText)}</div>`;
  document.body.prepend(h);
  return h.querySelector('.meta');
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Lecture/écriture des filtres dans le hash (#pays=FR&cat=news), pour les liens profonds et le bouton Retour. */
export const hashParams = () => new URLSearchParams(location.hash.slice(1));
export function setHash(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const h = p.toString();
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
}
