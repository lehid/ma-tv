// (2) Génère les playlists M3U perso + le catalogue compact pour le site web.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCatalog, loadConfig, filterEntries, loadTrustedStatus, writeJSON, PUBLIC, DATA } from './lib/api.mjs';
import { toM3U } from './lib/m3u.mjs';

const cfg = await loadConfig();
const { entries, countries, categories, languages } = await loadCatalog();
const status = await loadTrustedStatus();
const favorites = new Set(cfg.favorites || []);
const epgUrl = cfg.siteUrl ? `${cfg.siteUrl.replace(/\/$/, '')}/guide.xml.gz` : undefined;

await mkdir(PUBLIC, { recursive: true });
const write = async (file, list) => {
  await writeFile(join(PUBLIC, file), toM3U(list, { epgUrl, favorites }));
  console.log(`✔ ${file.padEnd(22)} ${String(list.length).padStart(5)} flux`);
};

const mine = filterEntries(entries, cfg, { status });
await write('playlist.m3u', mine);
await write('playlist-sfw.m3u', filterEntries(entries, cfg, { status, nsfwMode: 'exclude' }));
if (cfg.perCountryPlaylists) {
  for (const cc of cfg.countries || []) {
    const list = mine.filter((e) => e.country === cc);
    if (list.length) await write(`playlist-${cc.toLowerCase()}.m3u`, list);
  }
}

// Catalogue mondial compact pour le lecteur web (tous pays, filtrage côté navigateur).
const usedLangs = new Set(entries.flatMap((e) => e.languages));
await writeJSON(join(DATA, 'channels.json'), {
  generatedAt: new Date().toISOString(),
  favorites: [...favorites],
  mine: mine.map((e) => e.url),
  countries: Object.fromEntries(countries.map((c) => [c.code, [c.name, c.flag]])),
  languages: Object.fromEntries(languages.filter((l) => usedLangs.has(l.code)).map((l) => [l.code, l.name])),
  categories: categories.map((c) => c.id),
  // Format tableau pour réduire la taille : voir web/src/data.js
  entries: entries.map((e) => [
    e.id, e.name, e.country, e.categories, e.languages, e.nsfw ? 1 : 0, e.logo, e.url, e.quality,
    e.labels.includes('Geo-blocked') ? 1 : 0, e.labels.includes('Not 24/7') ? 1 : 0, e.referrer || e.userAgent ? 1 : 0,
  ]),
});
console.log(`✔ data/channels.json     ${String(entries.length).padStart(5)} flux (monde)`);
