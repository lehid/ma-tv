/* Panneau d'aide à la diffusion (Chromecast), inséré par le lecteur dans `.player-msg` via showMsg(html).
   HTML statique uniquement : le lecteur gère lui-même la fermeture ([data-help-close]).
   Sans dépendance au DOM ni au CSS : importable tel quel par les tests Node. */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Mac de bureau (pas iPhone ni iPad). `nav` est injectable pour les tests ; par défaut, le navigator global. */
export function isMacDesktop(nav) {
  const n = nav === undefined ? (typeof navigator !== 'undefined' ? navigator : null) : nav;
  if (!n) return false;
  const ua = String(n.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return false;
  // iPadOS se présente comme « MacIntel » mais a un écran tactile.
  if (n.maxTouchPoints > 1) return false;
  const uad = n.userAgentData;
  const platform = String((uad && uad.platform) || n.platform || '');
  return /mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua);
}

const TAB_CAST = 'menu de Chrome <strong class="cast-help-path">⋮ → Caster…</strong>';

function noDevice(mac) {
  const steps = [
    'Mets la TV et cet ordinateur sur le même réseau Wi-Fi. Vérifie ensuite que la diffusion Chromecast est activée sur la TV.',
  ];
  if (mac) {
    steps.push('Ouvre <strong>Réglages Système → Confidentialité et sécurité → Réseau local</strong> et active <strong>Google Chrome</strong>. Quitte Chrome, puis relance-le.');
  }
  steps.push(`En dernier recours : ${TAB_CAST} et choisis la TV. Ça diffuse tout l'onglet : passe ensuite le lecteur en plein écran.`);
  return {
    title: 'Aucune TV trouvée',
    body: `<ol class="cast-help-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>`,
  };
}

function failed() {
  return {
    title: "La TV n'a pas pu lancer cette chaîne",
    body: '<p>Certains diffuseurs empêchent la lecture sur Chromecast.</p>'
      + '<ul class="cast-help-tips">'
      + '<li>Essaie <strong>Autre source</strong>.</li>'
      + '<li>Choisis une autre chaîne.</li>'
      + `<li>Ou diffuse l'onglet : ${TAB_CAST}</li>`
      + '</ul>',
  };
}

/** HTML du panneau d'aide. kind : 'no-device' | 'failed'. `nav` : navigator simulé (tests). */
export function castHelpHtml(kind, nav) {
  const k = kind === 'failed' ? 'failed' : 'no-device';
  const c = k === 'failed' ? failed() : noDevice(isMacDesktop(nav));
  return `<div class="cast-help" data-help="${esc(k)}" role="group" aria-labelledby="cast-help-title">`
    + `<strong class="cast-help-title" id="cast-help-title">${esc(c.title)}</strong>`
    + c.body
    + '<button type="button" class="cast-help-close" data-help-close>Fermer</button>'
    + '</div>';
}
