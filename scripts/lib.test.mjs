import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEntries, clean } from './lib/api.mjs';
import { toM3U } from './lib/m3u.mjs';

const e = (o) => ({ id: 'X.fr', channel: 'X.fr', feed: null, name: 'X', country: 'FR', categories: ['news'], languages: ['fra'],
  nsfw: false, logo: null, url: 'https://x/a.m3u8', quality: null, labels: [], referrer: null, userAgent: null, ...o });

test('clean retire guillemets et retours ligne', () => {
  assert.equal(clean('a"b\nc'), "a'b c");
});

test('filtre pays OU langue, catégories exclues, NSFW tag/exclude/only', () => {
  const list = [e({}), e({ channel: 'Y', country: 'US', languages: ['eng'] }), e({ channel: 'Z', country: 'US', languages: ['fra'] }),
    e({ channel: 'S', categories: ['shop'] }), e({ channel: 'N', nsfw: true, categories: ['xxx'] })];
  const cfg = { countries: ['FR'], languages: ['fra'], excludeCategories: ['shop'] };
  assert.deepEqual(filterEntries(list, { ...cfg, nsfw: 'tag' }).map((x) => x.channel), ['X.fr', 'Z', 'N']);
  assert.deepEqual(filterEntries(list, { ...cfg, nsfw: 'exclude' }).map((x) => x.channel), ['X.fr', 'Z']);
  assert.deepEqual(filterEntries(list, { ...cfg, nsfw: 'only' }).map((x) => x.channel), ['N']);
});

test('flux morts exclus seulement si excludeDead', () => {
  const list = [e({})];
  const status = { 'https://x/a.m3u8': { ok: false } };
  assert.equal(filterEntries(list, { countries: ['FR'], excludeDead: true }, { status }).length, 0);
  assert.equal(filterEntries(list, { countries: ['FR'] }, { status }).length, 1);
});

test('M3U : tag NSFW, groupe, options VLC, pas d\'injection', () => {
  const m3u = toM3U([e({ nsfw: true, name: 'Evil"\n#EXTINF', referrer: 'https://r/' })], { epgUrl: 'https://g/guide.xml.gz' });
  assert.match(m3u, /^#EXTM3U url-tvg="https:\/\/g\/guide.xml.gz"/);
  assert.match(m3u, /tvg-nsfw="1"/);
  assert.match(m3u, /group-title="🔞 Adulte"/);
  assert.match(m3u, /#EXTVLCOPT:http-referrer=https:\/\/r\//);
  assert.equal(m3u.split('\n').filter((l) => l.startsWith('#EXTINF')).length, 1);
});

test('géo-bloqué ou 403 vu depuis le runner : jamais considéré mort', async () => {
  const { isDead } = await import('./lib/api.mjs');
  assert.equal(isDead(e({ labels: ['Geo-blocked'] }), { ok: false, code: 404 }), false);
  assert.equal(isDead(e({}), { ok: false, code: 403 }), false);
  assert.equal(isDead(e({}), { ok: false, reason: 'timeout' }), true);
  assert.equal(isDead(e({}), { ok: null }), false);
});
