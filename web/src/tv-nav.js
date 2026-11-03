// Navigation spatiale à la télécommande (flèches + OK + Retour) pour navigateurs de Smart TV.
export const KEYS = {
  back: new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack', 'XF86Back']),
  backCodes: new Set([10009, 461, 8, 27]), // Tizen, webOS, Backspace, Échap
  chUp: new Set(['PageUp', 'ChannelUp', 'MediaTrackNext']),
  chDown: new Set(['PageDown', 'ChannelDown', 'MediaTrackPrevious']),
  chUpCodes: new Set([427, 33]),
  chDownCodes: new Set([428, 34]),
};
export const isBack = (e) => KEYS.back.has(e.key) || KEYS.backCodes.has(e.keyCode);

const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const FOCUSABLE = 'button:not([disabled]), a[href], input, select, [tabindex="0"]';

function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** Élément le plus proche dans la direction donnée (distance pondérée vers l'axe principal). */
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
    const main = (bx - ax) * dx + (by - ay) * dy;
    if (main <= 1) continue;
    const cross = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
    const score = main + cross * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/**
 * Active la navigation. `getScope()` renvoie le conteneur actif (ex. le lecteur quand il est ouvert).
 * Dans un champ texte, ← → restent pour le curseur ; ↑ ↓ permettent d'en sortir.
 */
export function enableTvNav({ getScope = () => document, onBack } = {}) {
  document.addEventListener('keydown', (e) => {
    if (isBack(e)) {
      // Dans un champ, seules les vraies touches Retour de télécommande (Tizen 10009, webOS 461) quittent.
      const inField = e.target.matches?.('input, select, textarea');
      if (inField && e.keyCode !== 10009 && e.keyCode !== 461) return;
      if (onBack?.()) e.preventDefault();
      return;
    }
    const dir = DIRS[e.key];
    if (!dir) return;
    const t = e.target;
    if (t.matches?.('input') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    const scope = getScope();
    const start = scope.contains(t) && t !== document.body ? t : scope.querySelector(FOCUSABLE);
    if (!start) return;
    const next = start === t ? nearest(t, dir, scope) : start;
    if (next) {
      e.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  });
}
