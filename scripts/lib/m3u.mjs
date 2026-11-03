import { clean } from './api.mjs';
import { groupOf, FAVORITES_GROUP, NSFW_GROUP } from '../../web/src/labels.js';

const GROUP_RANK = (g) => (g === FAVORITES_GROUP ? 0 : g === NSFW_GROUP ? 2 : 1);

/** Trie : favoris, puis catégories (alpha), puis adulte en dernier ; puis par nom. */
export function sortEntries(entries, favorites) {
  return entries
    .map((e) => ({ e, g: groupOf(e, favorites) }))
    .sort((a, b) => GROUP_RANK(a.g) - GROUP_RANK(b.g) || a.g.localeCompare(b.g, 'fr') || a.e.name.localeCompare(b.e.name, 'fr'))
    .map(({ e, g }) => ({ ...e, group: g }));
}

/** Génère le texte M3U (format étendu compris par VLC, Kodi, TiviMate, SS IPTV…). */
export function toM3U(entries, { epgUrl, favorites = new Set() } = {}) {
  const out = [epgUrl ? `#EXTM3U url-tvg="${clean(epgUrl)}" x-tvg-url="${clean(epgUrl)}"` : '#EXTM3U'];
  for (const e of sortEntries(entries, favorites)) {
    const attrs = [
      `tvg-id="${clean(e.id)}"`,
      `tvg-name="${clean(e.name)}"`,
      e.logo && `tvg-logo="${clean(e.logo)}"`,
      e.country && `tvg-country="${clean(e.country)}"`,
      e.languages.length && `tvg-language="${clean(e.languages.join(';'))}"`,
      e.nsfw && 'tvg-nsfw="1"',
      `group-title="${clean(e.group)}"`,
    ].filter(Boolean).join(' ');
    const suffix = [e.quality, e.labels.includes('Geo-blocked') && 'géo-bloqué', e.labels.includes('Not 24/7') && 'pas 24/7']
      .filter(Boolean).join(', ');
    out.push(`#EXTINF:-1 ${attrs},${clean(e.name)}${suffix ? ` (${suffix})` : ''}`);
    if (e.referrer) out.push(`#EXTVLCOPT:http-referrer=${clean(e.referrer)}`);
    if (e.userAgent) out.push(`#EXTVLCOPT:http-user-agent=${clean(e.userAgent)}`);
    out.push(clean(e.url));
  }
  return out.join('\n') + '\n';
}
