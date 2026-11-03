// (5) Allège le guide XMLTV en JSON compact pour le site (pas de gros XML à parser sur une TV).
// Usage : node scripts/build-epg-now.mjs [chemin/guide.xml(.gz)]   (défaut : public/guide.xml.gz ou public/guide.xml)
import { readFile, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { writeJSON, PUBLIC, DATA } from './lib/api.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e] ?? m))
  .trim();

/** "20261103203000 +0100" → minutes epoch */
export function xmltvToMin(str) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(str || '');
  if (!m) return NaN;
  const [, Y, M, D, h, i, , tz = '+0000'] = m;
  const off = (tz[0] === '-' ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  return Date.UTC(+Y, +M - 1, +D, +h, +i) / 60000 - off;
}

/** Parse un XMLTV et garde la fenêtre [now - 3 h, now + 36 h]. */
export function parseXmltv(xml, now = Date.now() / 60000) {
  const from = now - 180;
  const to = now + 36 * 60;
  const programmes = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  const attr = (attrs, name) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];
  const tag = (body, name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body); return m ? decode(m[1]) : ''; };
  let m;
  while ((m = re.exec(xml))) {
    const start = xmltvToMin(attr(m[1], 'start'));
    const stop = xmltvToMin(attr(m[1], 'stop'));
    if (!(stop > from && start < to)) continue;
    const ch = decode(attr(m[1], 'channel') || '');
    const desc = tag(m[2], 'desc');
    (programmes[ch] ||= []).push([start, stop, tag(m[2], 'title'), tag(m[2], 'category'), desc.length > 160 ? `${desc.slice(0, 157)}…` : desc]);
  }
  for (const list of Object.values(programmes)) list.sort((a, b) => a[0] - b[0]);
  return programmes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const candidates = process.argv[2] ? [process.argv[2]] : [join(PUBLIC, 'guide.xml.gz'), join(PUBLIC, 'guide.xml')];
  let file;
  for (const c of candidates) { try { await access(c); file = c; break; } catch { /* suivant */ } }
  if (!file) {
    console.warn('⚠ Aucun guide.xml trouvé : epg-now.json vide (le site fonctionne sans guide).');
    await writeJSON(join(DATA, 'epg-now.json'), { generatedAt: new Date().toISOString(), programmes: {} });
  } else {
    const buf = await readFile(file);
    const xml = (file.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
    const programmes = parseXmltv(xml);
    await writeJSON(join(DATA, 'epg-now.json'), { generatedAt: new Date().toISOString(), programmes });
    const n = Object.values(programmes).reduce((s, l) => s + l.length, 0);
    console.log(`✔ data/epg-now.json : ${Object.keys(programmes).length} chaînes, ${n} programmes`);
  }
}
