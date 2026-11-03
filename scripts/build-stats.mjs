// (3) Agrégats du catalogue mondial → public/data/stats.json
import { join } from 'node:path';
import { loadCatalog, readJSONIfExists, writeJSON, DATA } from './lib/api.mjs';

export function qualityBucket(q) {
  const n = parseInt(q, 10);
  if (!n) return 'Inconnue';
  if (n >= 2160) return '4K';
  if (n >= 1080) return '1080p';
  if (n >= 720) return '720p';
  return 'SD (< 720p)';
}

export function computeStats(entries, languages, status) {
  const channelsBy = (keyFn) => {
    const m = new Map();
    for (const e of entries) for (const k of [].concat(keyFn(e))) {
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(e.channel);
    }
    return Object.fromEntries([...m].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]));
  };
  const streamsBy = (keyFn) => {
    const m = {};
    for (const e of entries) { const k = keyFn(e); m[k] = (m[k] || 0) + 1; }
    return m;
  };
  const langName = Object.fromEntries(languages.map((l) => [l.code, l.name]));
  const byLanguage = Object.entries(channelsBy((e) => e.languages)).slice(0, 15).map(([code, n]) => [langName[code] || code, n]);
  const results = status?.results || {};
  const checked = entries.filter((e) => results[e.url] && results[e.url].ok !== null);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      channels: new Set(entries.map((e) => e.channel)).size,
      streams: entries.length,
      countries: new Set(entries.map((e) => e.country)).size,
      nsfwChannels: new Set(entries.filter((e) => e.nsfw).map((e) => e.channel)).size,
      geoBlocked: entries.filter((e) => e.labels.includes('Geo-blocked')).length,
      not247: entries.filter((e) => e.labels.includes('Not 24/7')).length,
      httpOnly: entries.filter((e) => e.url.startsWith('http:')).length,
    },
    byCountry: Object.fromEntries(Object.entries(channelsBy((e) => e.country)).map(([cc, n]) => [cc, n])),
    byCategory: channelsBy((e) => (e.nsfw ? ['xxx'] : e.categories)),
    byLanguage,
    byQuality: streamsBy((e) => qualityBucket(e.quality)),
    health: checked.length ? { checkedAt: status.checkedAt, checked: checked.length, ok: checked.filter((e) => results[e.url].ok).length } : null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { entries, languages } = await loadCatalog();
  const status = await readJSONIfExists(join(DATA, 'status.json'));
  const stats = computeStats(entries, languages, status);
  await writeJSON(join(DATA, 'stats.json'), stats);
  console.log(`✔ data/stats.json : ${stats.totals.channels} chaînes, ${stats.totals.countries} pays`);
}
