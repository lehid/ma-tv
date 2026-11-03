// Préférences locales (favoris, filtres). Tout est protégé : le site marche sans stockage.
const KEY = 'ma-tv:v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* stockage indisponible */ }
}

export const prefs = {
  get: (k, fallback) => read()[k] ?? fallback,
  set(k, v) { const d = read(); d[k] = v; write(d); },
  /** { idChaîne: true|false } : ajoute ou retire un favori, y compris ceux venant de config.json. */
  favoriteOverrides: () => read().fav || {},
  setFavorite(id, on) {
    const d = read();
    d.fav = { ...(d.fav || {}), [id]: on };
    write(d);
    return on;
  },
};
