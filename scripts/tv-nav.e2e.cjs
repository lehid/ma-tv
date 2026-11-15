#!/usr/bin/env node
// Test de bout en bout de la navigation à la télécommande (flèches, OK, Retour, CH+/CH−, chiffres).
// Suppose un `vite preview` déjà lancé :
//   npx vite build && npx vite preview --port 4203 --strictPort &
//   npm run e2e:tv -- http://localhost:4173/     (ou BASE_URL=… npm run e2e:tv)
// Hors `npm test` : il faut Chromium (Playwright).
const { chromium } = require('playwright');

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:4173/').replace(/\/?$/, '/');
const results = [];
let page;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function press(key, wait = 60) { await page.keyboard.press(key); await sleep(wait); }

/** Télécommande Tizen/webOS : touche avec un keyCode que le clavier ne produit pas (10009, 461, 427, 428). */
async function remote(keyCode, key = 'Unidentified', wait = 120) {
  await page.evaluate(({ keyCode, key }) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
    Object.defineProperty(ev, 'which', { get: () => keyCode });
    (document.activeElement || document.body).dispatchEvent(ev);
  }, { keyCode, key });
  await sleep(wait);
}

/** Description de l'élément focalisé : identité, visibilité à l'écran (sous l'en-tête collant) et dans sa rangée. */
function focused() {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { tag: 'body' };
    const r = a.getBoundingClientRect();
    const hdr = document.querySelector('.top');
    const inHeader = hdr && hdr.contains(a);
    const hb = hdr && !inHeader && !a.closest('.player') ? hdr.getBoundingClientRect().bottom : 0;
    const row = a.closest('.chips');
    let inRow = true;
    if (row) { const p = row.getBoundingClientRect(); inRow = r.left >= p.left - 1 && r.right <= p.right + 1; }
    const ring = a.classList.contains('tile') ? getComputedStyle(a.querySelector('.plate')) : getComputedStyle(a);
    return {
      tag: a.tagName.toLowerCase(), id: a.id, cls: String(a.className),
      text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      cat: a.dataset.cat, tile: a.dataset.id, act: a.dataset.act,
      inPanel: !!a.closest('.filters-panel'), inPlayer: !!a.closest('.player'),
      inViewport: r.top >= hb - 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1,
      inRow, ring: ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0,
    };
  });
}
const label = (f) => (f.tag === 'body' ? 'body' : `${f.tag}${f.id ? '#' + f.id : ''}${f.cls ? '.' + f.cls.split(' ')[0] : ''} « ${f.text} »`);

function check(cond, msg) { if (!cond) throw new Error(msg); }

async function scenario(name, fn) {
  try {
    await fn();
    results.push([name, 'OK', '']);
  } catch (e) {
    results.push([name, 'ÉCHEC', e.message.split('\n')[0]]);
  }
}

async function load(hash = '') {
  await page.goto(`${BASE}index.html${hash}`, { waitUntil: 'load' });
  await page.waitForSelector('.tile', { timeout: 15000 });
  await page.evaluate(() => { window.scrollTo(0, 0); });
}
const focus = (sel) => page.evaluate((s) => { document.querySelector(s).focus(); }, sel);
const playerOpen = () => page.evaluate(() => { const p = document.querySelector('.player'); return !!p && !p.hidden; });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Pas de vrais flux pendant le test : le lecteur s'ouvre quand même.
  await page.route(/\.m3u8|\.ts(\?|$)/, (r) => r.abort());

  await scenario('Chargement : les flèches mènent à la recherche', async () => {
    await load();
    let f;
    for (let i = 0; i < 4; i++) { await press('ArrowDown'); f = await focused(); if (f.id === 'q') break; }
    check(f.id === 'q', `focus sur ${label(f)}`);
  });

  await scenario('Recherche → Pays (Droite)', async () => {
    await focus('#q');
    await press('ArrowRight');
    const f = await focused();
    check(f.id === 'country', `focus sur ${label(f)}`);
  });

  await scenario('Recherche avec texte : ← → déplacent le curseur, puis sortent au bord', async () => {
    await focus('#q');
    await page.keyboard.type('fr');
    await sleep(300);
    await press('ArrowLeft');
    let f = await focused();
    check(f.id === 'q', `← a quitté le champ (${label(f)})`);
    await press('ArrowRight');
    f = await focused();
    check(f.id === 'q', `→ a quitté le champ avant la fin du texte (${label(f)})`);
    await press('ArrowRight');
    f = await focused();
    check(f.id === 'country', `→ en fin de texte : ${label(f)}`);
    await focus('#q');
    await page.fill('#q', '');
    await page.dispatchEvent('#q', 'input');
    await sleep(300);
  });

  await scenario('Pays → Filtres (Droite)', async () => {
    await focus('#country');
    await press('ArrowRight');
    const f = await focused();
    check(f.id === 'filters-btn', `focus sur ${label(f)}`);
    check(f.ring, 'pas d\'anneau de focus sur « Filtres »');
  });

  let chipCount = 0;
  await scenario('Filtres → pastilles (Bas), sur la pastille active', async () => {
    await load();
    await focus('#filters-btn');
    await press('ArrowDown');
    const f = await focused();
    check(f.cls.includes('chip'), `focus sur ${label(f)}`);
    check(f.cat === '', `pastille ${label(f)} au lieu de « Tout »`);
  });

  await scenario('Chaque pastille, la rangée défile pour la garder visible', async () => {
    await load();
    await focus('.chip');
    chipCount = await page.$$eval('.chip', (l) => l.length);
    check(chipCount > 5, `seulement ${chipCount} pastilles`);
    const overflow = await page.$eval('#chips', (c) => c.scrollWidth > c.clientWidth);
    for (let i = 1; i < chipCount; i++) {
      await press('ArrowRight');
      const f = await focused();
      const idx = await page.evaluate(() => [...document.querySelectorAll('.chip')].indexOf(document.activeElement));
      check(idx === i, `→ n° ${i} : focus sur ${label(f)} (index ${idx})`);
      check(f.inRow && f.inViewport, `pastille ${i} « ${f.text} » hors de la rangée visible`);
      check(f.ring, `pastille ${i} sans anneau de focus`);
    }
    const scrolled = await page.$eval('#chips', (c) => c.scrollLeft);
    check(!overflow || scrolled > 0, 'la rangée n\'a pas défilé');
    for (let i = chipCount - 2; i >= 0; i--) {
      await press('ArrowLeft');
      const f = await focused();
      check(f.inRow, `← pastille ${i} « ${f.text} » hors de la rangée visible`);
    }
    const f = await focused();
    check(f.cat === '', `retour à gauche : ${label(f)}`);
  });

  await scenario('Pastilles → grille (Bas), première rangée → pastilles (Haut)', async () => {
    await load();
    await focus('.chip');
    await press('ArrowRight'); await press('ArrowRight');
    const chip = await focused();
    await press('ArrowDown');
    let f = await focused();
    check(f.cls.includes('tile'), `Bas : ${label(f)}`);
    const firstRow = await page.evaluate(() => {
      const a = document.activeElement; const t = document.querySelector('.tile');
      return Math.abs(a.getBoundingClientRect().top - t.getBoundingClientRect().top) < 2;
    });
    check(firstRow, 'Bas ne mène pas à la première rangée de tuiles');
    await press('ArrowUp');
    f = await focused();
    check(f.cls.includes('chip'), `Haut : ${label(f)}`);
    check(f.cat === '', `Haut doit revenir sur la pastille active « Tout », pas sur ${label(f)} (venait de « ${chip.text} »)`);
  });

  await scenario('Entrée sur une pastille filtre la grille, le focus reste dessus', async () => {
    await load();
    await focus('.chip');
    const before = await page.$eval('#summary', (e) => e.textContent);
    for (const steps of [2, 1]) {
      for (let i = 0; i < steps; i++) await press('ArrowRight');
      const chip = await focused();
      await press('Enter', 300);
      const f = await focused();
      check(f.cls.includes('chip') && f.cat === chip.cat, `après Entrée sur « ${chip.text} » : focus sur ${label(f)}`);
      check(f.inRow, `pastille « ${chip.text} » hors de la rangée visible après filtrage`);
      const pressed = await page.$eval('.chip[aria-pressed="true"]', (e) => e.dataset.cat);
      check(pressed === chip.cat, `pastille active : ${pressed} au lieu de ${chip.cat}`);
      const hash = await page.evaluate(() => location.hash);
      check(hash.includes(`cat=${encodeURIComponent(chip.cat)}`), `hash ${hash}`);
    }
    const after = await page.$eval('#summary', (e) => e.textContent);
    check(after !== before, 'la grille n\'a pas été filtrée');
    await press('ArrowDown');
    let f = await focused();
    check(f.cls.includes('tile'), `Bas après filtrage : ${label(f)}`);
    await press('ArrowUp');
    f = await focused();
    const pressed = await page.$eval('.chip[aria-pressed="true"]', (e) => e.dataset.cat);
    check(f.cat === pressed, `Haut : ${label(f)} au lieu de la pastille active`);
  });

  await scenario('Entrée sur « Filtres » ouvre le panneau, on y navigue', async () => {
    await load();
    await focus('#filters-btn');
    await press('Enter', 150);
    check(await page.$eval('#filters-panel', (d) => !d.hidden), 'panneau fermé');
    const seen = new Set();
    await press('ArrowDown');
    let f = await focused();
    check(f.inPanel, `Bas : ${label(f)}`);
    // Tout à gauche, puis tout à droite : chaque contrôle du panneau doit être atteint.
    for (const k of ['ArrowLeft', 'ArrowRight']) {
      for (let i = 0; i < 10; i++) {
        f = await focused();
        check(f.inPanel, `${k} : sortie du panneau vers ${label(f)}`);
        seen.add(f.id || f.text);
        await press(k);
        const g = await focused();
        if (g.id === f.id && g.text === f.text) break;
      }
    }
    const all = await page.$$eval('.filters-panel button, .filters-panel select', (l) => l.map((e) => e.id || e.textContent.trim()));
    const missing = all.filter((x) => !seen.has(x));
    check(!missing.length, `non atteints : ${missing.join(', ')}`);
  });

  await scenario('Échap referme le panneau sans quitter la page', async () => {
    await focus('#lang');
    const url = page.url();
    await press('Escape', 150);
    check(!(await page.$eval('#filters-panel', (d) => !d.hidden)), 'panneau toujours ouvert');
    const f = await focused();
    check(f.id === 'filters-btn', `focus sur ${label(f)}`);
    check(page.url() === url, `URL changée : ${page.url()}`);
  });

  await scenario('Retour (Tizen 10009, webOS 461) referme le panneau', async () => {
    for (const code of [10009, 461]) {
      await focus('#filters-btn');
      await press('Enter', 150);
      await press('ArrowDown');
      await remote(code);
      check(!(await page.$eval('#filters-panel', (d) => !d.hidden)), `${code} : panneau toujours ouvert`);
      const f = await focused();
      check(f.id === 'filters-btn', `${code} : focus sur ${label(f)}`);
    }
  });

  let openedId;
  await scenario('Tuiles : focus visible, la page défile pour les garder à l\'écran', async () => {
    await load();
    await focus('.chip');
    await press('ArrowDown');
    for (let i = 0; i < 8; i++) {
      await press('ArrowDown');
      const f = await focused();
      check(f.cls.includes('tile'), `Bas ${i + 1} : ${label(f)}`);
      check(f.inViewport, `Bas ${i + 1} : tuile « ${f.text} » hors écran`);
      check(f.ring, `Bas ${i + 1} : pas d'anneau de focus`);
    }
    await press('ArrowRight'); await press('ArrowRight');
    for (let i = 0; i < 8; i++) {
      await press('ArrowUp');
      const f = await focused();
      check(f.inViewport, `Haut ${i + 1} : « ${f.text} » hors écran ou sous l'en-tête`);
    }
    for (let i = 0; i < 4; i++) await press('ArrowDown');
    openedId = (await focused()).tile;
  });

  await scenario('Entrée sur une tuile ouvre le lecteur', async () => {
    await press('Enter', 400);
    check(await playerOpen(), 'lecteur fermé');
    const f = await focused();
    check(f.inPlayer, `focus hors du lecteur : ${label(f)}`);
  });

  await scenario('Lecteur : les flèches parcourent l\'OSD, y compris « Chaînes »', async () => {
    const want = await page.$$eval('.player button', (l) => l.filter((b) => b.getClientRects().length).map((b) => b.dataset.act || b.dataset.track || b.dataset.cast));
    const seen = new Set();
    for (let i = 0; i < 12; i++) { seen.add((await focused()).act); await press('ArrowLeft'); }
    for (let i = 0; i < 12; i++) { seen.add((await focused()).act); await press('ArrowRight'); }
    for (let i = 0; i < 3; i++) { seen.add((await focused()).act); await press('ArrowUp'); }
    const top = await focused();
    seen.add(top.act);
    check(top.act === 'close', `Haut : ${label(top)} au lieu de « Chaînes »`);
    check(top.ring, '« Chaînes » sans anneau de focus');
    await press('ArrowDown');
    const f = await focused();
    check(f.inPlayer && f.act !== 'close', `Bas depuis « Chaînes » : ${label(f)}`);
    const missing = want.filter((a) => !seen.has(a));
    check(!missing.length, `boutons non atteints : ${missing.join(', ')}`);
  });

  await scenario('Lecteur : le focus reste sur Précédente/Suivante en zappant', async () => {
    await page.evaluate(() => document.querySelector('.player [data-act="prev"]').focus());
    const name = await page.$eval('.player h2', (e) => e.textContent);
    await press('Enter', 200);
    const f = await focused();
    check(await page.$eval('.player h2', (e) => e.textContent) !== name, 'pas de changement de chaîne');
    check(f.act === 'prev', `focus sauté sur ${label(f)}`);
    await page.evaluate(() => document.querySelector('.player [data-act="next"]').focus());
    await press('Enter', 200);
  });

  await scenario('OSD masqué : une touche le réveille sans agir', async () => {
    await page.evaluate(() => document.querySelector('.player [data-act="next"]').focus());
    await page.waitForFunction(() => document.querySelector('.player').classList.contains('idle'), null, { timeout: 7000 });
    const before = await focused();
    await press('ArrowRight');
    const idle = await page.$eval('.player', (p) => p.classList.contains('idle'));
    check(!idle, 'OSD toujours masqué');
    const f = await focused();
    check(f.act === before.act, `la touche de réveil a déplacé le focus (${label(before)} → ${label(f)})`);
    await page.waitForFunction(() => document.querySelector('.player').classList.contains('idle'), null, { timeout: 7000 });
    const name = await page.$eval('.player h2', (e) => e.textContent);
    await press('Enter', 200);
    check(await page.$eval('.player h2', (e) => e.textContent) === name, 'OK sur OSD masqué a zappé au lieu de réveiller');
  });

  await scenario('CH+/CH− (PageUp/PageDown, 427/428) zappent', async () => {
    const name = () => page.$eval('.player h2', (e) => e.textContent);
    const n0 = await name();
    await press('PageUp', 200);
    const n1 = await name();
    check(n1 !== n0, 'PageUp sans effet');
    await press('PageDown', 200);
    check(await name() === n0, 'PageDown ne revient pas');
    await remote(427, 'Unidentified', 200);
    check(await name() === n1, '427 (CH+) sans effet');
    await remote(428, 'Unidentified', 200);
    check(await name() === n0, '428 (CH−) sans effet');
    check((await focused()).inPlayer, 'focus sorti du lecteur');
  });

  await scenario('Retour ferme le lecteur et rend le focus à la tuile', async () => {
    await press('Escape', 200);
    check(!(await playerOpen()), 'lecteur toujours ouvert');
    const f = await focused();
    check(f.tile === openedId, `focus sur ${label(f)} au lieu de la tuile ${openedId}`);
    check(f.inViewport, 'tuile hors écran');
  });

  await scenario('Favori dans le lecteur puis Retour : focus sur la tuile (grille redessinée)', async () => {
    await focus(`.tile[data-id="${openedId}"]`);
    await press('Enter', 300);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => document.querySelector('.player [data-act="fav"]').focus());
      await press('Enter', 200);
    }
    await remote(10009);
    check(!(await playerOpen()), '10009 : lecteur toujours ouvert');
    const f = await focused();
    check(f.tile === openedId, `focus sur ${label(f)} au lieu de la tuile ${openedId}`);
  });

  await scenario('Lecteur : « Chaînes » (OK) ferme et rend le focus', async () => {
    await press('Enter', 300);
    check(await playerOpen(), 'lecteur fermé');
    await page.evaluate(() => document.querySelector('.player [data-act="close"]').focus());
    await press('Enter', 200);
    check(!(await playerOpen()), 'lecteur toujours ouvert');
    const f = await focused();
    check(f.tile === openedId, `focus sur ${label(f)}`);
  });

  await scenario('Chiffres 1, 2 puis attente : chaîne 12', async () => {
    await load();
    await focus('.tile');
    await press('1'); await press('2');
    check(await page.$eval('#dial', (d) => !d.hidden && d.textContent === '12'), 'pas d\'affichage « 12 »');
    await page.waitForFunction(() => !document.querySelector('.player').hidden, null, { timeout: 4000 });
    const lcn = await page.$eval('.player .lcn', (e) => e.textContent);
    check(lcn === '12', `chaîne ${lcn}`);
    check((await focused()).inPlayer, 'focus hors du lecteur');
    await press('Escape', 200);
    check(!(await playerOpen()), 'Échap ne ferme pas');
  });

  await scenario('Aucune erreur JavaScript', async () => {
    check(!errors.length, errors.join(' | '));
  });

  await browser.close();
  const w = Math.max(...results.map((r) => r[0].length));
  for (const [n, s, m] of results) console.log(`${s === 'OK' ? 'OK   ' : 'ÉCHEC'}  ${n.padEnd(w)}  ${m}`);
  const ko = results.filter((r) => r[1] !== 'OK').length;
  console.log(`\n${results.length - ko}/${results.length} scénarios OK`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
