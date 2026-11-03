// Intégration aux applis « coquilles » Smart TV (tv-apps/) : la coquille redirige vers ce site,
// donc l'enregistrement des touches et la sortie de l'appli vivent ici. Tout est gardé :
// hors TV (navigateur de bureau, mobile), ces fonctions ne font rien.

// Touches que Tizen ne transmet à la page que si on les enregistre (flèches, OK et Retour arrivent toujours).
const TIZEN_KEYS = ['ChannelUp', 'ChannelDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'];

let registered = false;

/** Tizen : demande les touches télécommande utiles. Sans effet hors Samsung. */
export function registerTvKeys() {
  if (registered) return;
  registered = true;
  const tvi = window.tizen && window.tizen.tvinputdevice;
  if (!tvi) return;
  try {
    // registerKeyBatch échoue en bloc si une seule touche manque au modèle : on filtre d'abord.
    let names = TIZEN_KEYS;
    try {
      const supported = new Set(tvi.getSupportedKeys().map((k) => k.name));
      names = TIZEN_KEYS.filter((k) => supported.has(k));
    } catch (e) { /* getSupportedKeys absent : on tente la liste complète */ }
    if (tvi.registerKeyBatch) {
      tvi.registerKeyBatch(names, null, () => {
        for (const k of names) { try { tvi.registerKey(k); } catch (e) { /* touche absente */ } }
      });
    } else {
      for (const k of names) { try { tvi.registerKey(k); } catch (e) { /* touche absente */ } }
    }
  } catch (e) { /* API refusée (page hors appli, privilège manquant) */ }
}

/** Ferme l'appli TV (Tizen ou webOS). Renvoie false si on n'est pas dans une appli. */
export function exitTvApp() {
  try {
    if (window.tizen && window.tizen.application) {
      window.tizen.application.getCurrentApplication().exit();
      return true;
    }
  } catch (e) { /* pas dans une appli Tizen */ }
  try {
    // webOS : PalmSystem n'existe que dans une appli (pas dans le navigateur de la TV) ; window.close() quitte l'appli.
    if (window.PalmSystem) {
      if (window.webOS && window.webOS.platformBack) window.webOS.platformBack();
      else window.close();
      return true;
    }
  } catch (e) { /* pas dans une appli webOS */ }
  return false;
}
