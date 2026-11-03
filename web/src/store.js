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
  favorites: () => read().favorites || [],
  toggleFavorite(id) {
    const d = read();
    const set = new Set(d.favorites || []);
    set.has(id) ? set.delete(id) : set.add(id);
    d.favorites = [...set];
    write(d);
    return set.has(id);
  },
};
