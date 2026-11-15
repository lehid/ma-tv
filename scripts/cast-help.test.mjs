import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castHelpHtml, isMacDesktop } from '../web/src/cast-help.js';

const MAC = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', maxTouchPoints: 0 };
const MAC_UAD = { platform: '', userAgent: 'Mozilla/5.0', userAgentData: { platform: 'macOS' } };
const WIN = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0', userAgentData: { platform: 'Windows' } };
const LINUX = { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0' };
const ANDROID = { platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0 Mobile' };
const IPHONE = { platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' };
const IPAD = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 };

test('isMacDesktop : Mac oui, iPhone/iPad/Windows/Linux/Android non', () => {
  assert.equal(isMacDesktop(MAC), true);
  assert.equal(isMacDesktop(MAC_UAD), true);
  for (const n of [WIN, LINUX, ANDROID, IPHONE, IPAD, null]) assert.equal(isMacDesktop(n), false);
});

test('les deux kinds : racine data-help et bouton data-help-close', () => {
  for (const kind of ['no-device', 'failed']) {
    const html = castHelpHtml(kind, WIN);
    assert.match(html, new RegExp(`^<div class="cast-help" data-help="${kind}"`));
    assert.match(html, /<button type="button"[^>]* data-help-close>Fermer<\/button>/);
    assert.ok(html.endsWith('</div>'));
    assert.doesNotMatch(html, /\son\w+=/); // aucun gestionnaire en ligne
  }
});

test('no-device : étape Réseau local seulement sur Mac, liste numérotée', () => {
  const mac = castHelpHtml('no-device', MAC);
  assert.match(mac, /Aucune TV trouvée/);
  assert.match(mac, /Réseau local/);
  assert.match(mac, /Google Chrome/);
  assert.equal((mac.match(/<li>/g) || []).length, 3);
  for (const n of [WIN, LINUX, ANDROID, IPHONE, IPAD]) {
    const html = castHelpHtml('no-device', n);
    assert.match(html, /<ol class="cast-help-steps">/);
    assert.doesNotMatch(html, /Réseau local/);
    assert.equal((html.match(/<li>/g) || []).length, 2);
    assert.match(html, /Caster…/);
  }
});

test('failed : titre, Autre source, autre chaîne, Caster…', () => {
  const html = castHelpHtml('failed', MAC);
  assert.doesNotMatch(html, /Réseau local/);
  assert.match(html, /n&#39;a pas pu lancer cette chaîne/);
  assert.match(html, /Autre source/);
  assert.match(html, /autre chaîne/);
  assert.match(html, /Caster…/);
});

test('texte variable échappé : titres sans < brut ni apostrophe nue', () => {
  for (const kind of ['no-device', 'failed']) {
    const title = castHelpHtml(kind, MAC).match(/id="cast-help-title">([^]*?)<\/strong>/)[1];
    assert.doesNotMatch(title, /[<>"']/);
  }
});

test('navigator global de Node : appel sans argument sans erreur', () => {
  assert.equal(typeof isMacDesktop(), 'boolean');
  assert.match(castHelpHtml('no-device'), /data-help="no-device"/);
});
