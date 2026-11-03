// Génère les icônes PNG des applis TV (tv-apps/) à partir de public/icon.svg.
// Usage ponctuel : node scripts/build-tv-icons.mjs (exige Playwright + Chromium, non inclus dans les dépendances).
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const BG = '#0d1420'; // fond de l'icône (pour les formats non carrés)

// [fichier, largeur, hauteur, plein cadre ?]
const ICONS = [
  ['tv-apps/tizen/icon.png', 512, 423, false], // Samsung : icône d'appli TV 512×423
  ['tv-apps/webos/icon.png', 80, 80, true], // LG : icon 80×80
  ['tv-apps/webos/largeIcon.png', 130, 130, true], // LG : largeIcon 130×130
];

const browser = await chromium.launch();
try {
  for (const [file, w, h, full] of ICONS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const side = full ? Math.min(w, h) : Math.round(Math.min(w, h) * 0.7);
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;
      background:${full ? 'transparent' : BG};display:flex;align-items:center;justify-content:center}
      svg{width:${side}px;height:${side}px;display:block}</style>${svg}`);
    await page.screenshot({ path: new URL(`../${file}`, import.meta.url).pathname, omitBackground: full });
    await page.close();
    console.log(`${file} (${w}×${h})`);
  }
} finally {
  await browser.close();
}
