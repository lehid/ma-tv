// (5) Construit epg/channels.xml : pour chaque chaîne de ma playlist, la meilleure source EPG de guides.json.
// Ce fichier est ensuite passé au grabber iptv-org/epg (`npm run grab --- --channels=...`).
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCatalog, loadConfig, filterEntries, fetchJSON, ROOT, isMain } from './lib/api.mjs';

const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function pickGuides(entries, guides, cfg) {
  const preferred = cfg.epg?.preferredSites || [];
  const langs = new Set((cfg.languages || []).map((l) => l.slice(0, 2)));
  const byChannel = new Map();
  for (const g of guides) {
    if (!byChannel.has(g.channel)) byChannel.set(g.channel, []);
    byChannel.get(g.channel).push(g);
  }
  const rank = (g, feed) => {
    const p = preferred.indexOf(g.site);
    return (g.feed === feed ? 100 : g.feed == null ? 50 : 0) + (p === -1 ? 0 : 40 - p) + (langs.has(g.lang) ? 10 : 0);
  };
  const out = new Map(); // tvg-id → guide
  for (const e of entries) {
    if (out.has(e.id)) continue;
    const candidates = byChannel.get(e.channel);
    if (!candidates) continue;
    const best = [...candidates].sort((a, b) => rank(b, e.feed) - rank(a, e.feed))[0];
    out.set(e.id, { ...best, name: e.name });
  }
  return out;
}

if (isMain(import.meta.url)) {
  const cfg = await loadConfig();
  const [{ entries }, guides] = await Promise.all([loadCatalog(), fetchJSON('guides')]);
  const picked = pickGuides(filterEntries(entries, cfg), guides, cfg);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<channels>'];
  for (const [id, g] of picked) {
    lines.push(`  <channel site="${xmlEsc(g.site)}" lang="${xmlEsc(g.lang)}" xmltv_id="${xmlEsc(id)}" site_id="${xmlEsc(g.site_id)}">${xmlEsc(g.site_name || g.name)}</channel>`);
  }
  lines.push('</channels>', '');
  await mkdir(join(ROOT, 'epg'), { recursive: true });
  await writeFile(join(ROOT, 'epg', 'channels.xml'), lines.join('\n'));
  const sites = new Set([...picked.values()].map((g) => g.site));
  console.log(`✔ epg/channels.xml : ${picked.size} chaînes avec guide, ${sites.size} sites sources`);
}
