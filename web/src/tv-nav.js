// Navigation spatiale à la télécommande (flèches + OK + Retour) pour navigateurs de Smart TV.
import { registerTvKeys, exitTvApp } from './tv-app.js';

export const KEYS = {
  back: new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack', 'XF86Back']),
  backCodes: new Set([10009, 461, 8, 27]), // Tizen, webOS, Backspace, Échap
  chUp: new Set(['PageUp', 'ChannelUp', 'MediaTrackNext']),
  chDown: new Set(['PageDown', 'ChannelDown', 'MediaTrackPrevious']),
  chUpCodes: new Set([427, 33]),
  chDownCodes: new Set([428, 34]),
  playPause: new Set(['MediaPlayPause', 'MediaPlay', 'MediaPause']),
  playPauseCodes: new Set([10252, 415, 19]), // Tizen/webOS : Lecture/Pause, Lecture, Pause
};
export const isBack = (e) => KEYS.back.has(e.key) || KEYS.backCodes.has(e.keyCode);
const isRemoteBack = (e) => e.keyCode === 10009 || e.keyCode === 461;

// Vieux navigateurs de TV : e.key peut valoir « Up », « Left »… ou manquer (keyCode 37-40 reste fiable).
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };
const DIR_CODES = { 38: [0, -1], 40: [0, 1], 37: [-1, 0], 39: [1, 0] };
/** Direction d'une touche fléchée, ou null. */
export const arrowDir = (e) => DIRS[e.key] || (!e.key || e.key === 'Unidentified' ? DIR_CODES[e.keyCode] : null) || null;
export const isOk = (e) => e.key === 'Enter' || e.keyCode === 13;

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]';
const MARGIN = 24; // marge gardée autour de l'élément focalisé quand on fait défiler

function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function firstVisible(root) {
  const list = root.querySelectorAll(FOCUSABLE);
  for (let i = 0; i < list.length; i++) if (visible(list[i])) return list[i];
  return null;
}

/**
 * Élément le plus proche dans la direction donnée. On mesure d'un bord à l'autre (pas de centre à centre) :
 * un voisin aligné (même rangée ou même colonne) l'emporte ainsi sur un voisin en diagonale,
 * ex. Droite depuis la recherche → Pays, Bas depuis « Filtres » → le panneau et pas les pastilles.
 */
function nearest(from, [dx, dy], scope) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of scope.querySelectorAll(FOCUSABLE)) {
    if (el === from || !visible(el)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    if ((bx - ax) * dx + (by - ay) * dy <= 1) continue; // pas dans la bonne direction
    const gap = dx > 0 ? b.left - a.right : dx < 0 ? a.left - b.right : dy > 0 ? b.top - a.bottom : a.top - b.bottom;
    const side = dx ? Math.max(0, b.top - a.bottom, a.top - b.bottom) : Math.max(0, b.left - a.right, a.left - b.right);
    // ← → restent dans la rangée (pas de saut vers la ligne d'en dessous en bout de rangée) ;
    // ↑ ↓ acceptent un voisin en diagonale s'il est tout entier au-delà du bord.
    if (side > 0 && (dx || gap < -1)) continue;
    const offset = Math.abs(dx ? by - ay : bx - ax);
    const score = Math.max(0, gap) + side * 4 + offset * 0.1;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/** Rangée à défilement horizontal (ex. les pastilles de catégories) qui contient `el`, s'il y en a une. */
function hScroller(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX;
    if (ox === 'auto' || ox === 'scroll') return p;
  }
  return null;
}

/**
 * En entrant dans une rangée défilante depuis l'extérieur, on va sur l'élément sélectionné
 * (la pastille active) plutôt que sur celui qui se trouve par hasard au-dessus ou au-dessous.
 */
function enterRow(next, from) {
  const row = hScroller(next);
  if (!row || row.contains(from)) return next;
  const sel = row.querySelector('[aria-pressed="true"], [aria-selected="true"], [aria-current="true"], [aria-current="page"]');
  return sel && visible(sel) ? sel : next;
}

// En-tête collant : l'élément focalisé doit rester dessous, pas caché derrière.
function stickyBottom(el) {
  const h = document.querySelector('.top');
  if (!h || h.contains(el)) return 0;
  const pos = getComputedStyle(h).position;
  return pos === 'sticky' || pos === '-webkit-sticky' || pos === 'fixed' ? Math.max(0, h.getBoundingClientRect().bottom) : 0;
}

/**
 * Fait défiler la rangée horizontale puis la page pour garder `el` à l'écran. Sans animation :
 * une animation douce se cumule mal quand la touche est maintenue, et rame sur les TV.
 */
export function reveal(el) {
  if (!el || !el.getBoundingClientRect) return;
  const row = hScroller(el);
  if (row && row.scrollWidth > row.clientWidth) {
    const p = row.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const m = Math.min(64, p.width / 4);
    if (r.left < p.left + m) row.scrollLeft += r.left - p.left - m;
    else if (r.right > p.right - m) row.scrollLeft += r.right - p.right + m;
  }
  const r = el.getBoundingClientRect();
  const top = stickyBottom(el) + MARGIN;
  const bottom = window.innerHeight - MARGIN;
  if (r.top < top || r.height > bottom - top) window.scrollBy(0, r.top - top);
  else if (r.bottom > bottom) window.scrollBy(0, r.bottom - bottom);
}

/** Donne le focus sans le défilement natif (brutal, ou qui ignore l'en-tête collant), puis révèle l'élément. */
export function focusEl(el) {
  if (!el) return;
  try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  reveal(el);
}

/**
 * Panneau déplié qui contient `el` (ou dont `el` est le bouton) : bouton `aria-expanded="true"`
 * + `aria-controls` (ex. Filtres), ou <details open>. Renvoie { toggle, close() } ou null.
 */
function openPanel(el) {
  const btns = document.querySelectorAll('[aria-expanded="true"][aria-controls]');
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    const panel = document.getElementById(b.getAttribute('aria-controls'));
    if (b === el || (panel && panel.contains(el))) return { toggle: b, close: () => b.click() };
  }
  const det = el.closest && el.closest('details[open]');
  return det ? { toggle: det.querySelector('summary'), close: () => { det.open = false; } } : null;
}

// Classe `tv-nav` sur <html> pendant l'usage du clavier ou de la télécommande : sert d'anneau de focus
// de secours (fin de style.css) aux navigateurs de TV antérieurs à Chromium 86, qui ignorent :focus-visible.
function keyboardMode(on) {
  const c = document.documentElement.classList;
  if (on) c.add('tv-nav'); else c.remove('tv-nav');
}

/**
 * Active la navigation. `getScope()` renvoie le conteneur actif (ex. le lecteur quand il est ouvert).
 * Dans un champ texte, ← → déplacent le curseur et n'en sortent qu'au bord du texte ; ↑ ↓ en sortent.
 * Retour : `onBack()` d'abord (ex. fermer le lecteur), puis fermeture du panneau déplié qui contient le focus
 * (bouton aria-expanded/aria-controls comme « Filtres », ou <details>), avec retour du focus sur son bouton.
 */
export function enableTvNav({ getScope = () => document, onBack } = {}) {
  registerTvKeys();
  document.addEventListener('mousedown', () => keyboardMode(false), true);
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const t = e.target;
    if (isBack(e)) {
      keyboardMode(true);
      // Dans un champ texte, Échap et Retour arrière servent à l'édition ; seules les vraies touches
      // Retour de télécommande (Tizen 10009, webOS 461) en sortent.
      if (t.matches && t.matches('input, textarea') && !isRemoteBack(e)) return;
      if (onBack && onBack()) { e.preventDefault(); return; }
      const panel = openPanel(t);
      if (panel) {
        e.preventDefault();
        panel.close();
        focusEl(panel.toggle);
        return;
      }
      // Retour sur la page d'accueil sans rien à fermer : dans l'appli TV, on la quitte.
      if (isRemoteBack(e) && exitTvApp()) e.preventDefault();
      return;
    }
    if (isOk(e)) { keyboardMode(true); return; }
    const dir = arrowDir(e);
    if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
    keyboardMode(true);
    if (dir[0] && t.matches && t.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea')) {
      // ← → dans un champ : on n'en sort qu'au bord du texte.
      let pos = null;
      try { pos = t.selectionStart === t.selectionEnd ? t.selectionStart : null; } catch (err) { /* type sans curseur */ }
      if (pos === null || (dir[0] < 0 ? pos > 0 : pos < (t.value || '').length)) return;
    }
    const scope = getScope();
    let next;
    if (t !== scope && t !== document.body && scope.contains(t)) {
      next = nearest(t, dir, scope);
      if (next) next = enterRow(next, t);
    } else {
      // Rien de focalisé (ou focus hors du conteneur actif) : premier élément du contenu principal.
      const main = scope === document ? document.querySelector('main') : null;
      next = (main && firstVisible(main)) || firstVisible(scope === document ? document.body : scope);
    }
    if (next) {
      e.preventDefault();
      focusEl(next);
    }
  });
}
