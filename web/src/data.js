// Chargement et décodage des données produites par les scripts (public/data/*.json).
import { groupOf, FAVORITES_GROUP, NSFW_GROUP } from './labels.js';
import { prefs } from './store.js';

const base = import.meta.env.BASE_URL;
const getJSON = (path) => fetch(`${base}${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

const QUALITY = (q) => parseInt(q, 10) || 0;
const GROUP_RANK = (g) => (g === FAVORITES_GROUP ? 0 : g === NSFW_GROUP ? 2 : 1);

/**
 * Renvoie { channels, countries, languages, categories, generatedAt }.
 * Une « chaîne » = un tvg-id (chaîne@feed) regroupant ses flux, triés du meilleur au moins bon.
 * Les numéros (lcn) suivent l'ordre de la playlist perso, puis le reste du monde.
 */
export async function loadChannels() {
  const [raw, status] = await Promise.all([getJSON('data/channels.json'), getJSON('data/status.json')]);
  if (!raw) throw new Error('data/channels.json introuvable : lance « npm run playlist ».');
  const results = status?.results || {};
  const mine = new Set(raw.mine);
  const favorites = new Set([...raw.favorites, ...prefs.favorites()]);
  const byId = new Map();
  for (const [id, name, country, categories, languages, nsfw, logo, url, quality, geo, not247, headers] of raw.entries) {
    let ch = byId.get(id);
    if (!ch) {
      ch = { id, channel: id.split('@')[0], name, country, categories, languages, nsfw: !!nsfw, logo, streams: [], mine: false };
      byId.set(id, ch);
    }
    if (!ch.logo && logo) ch.logo = logo;
    if (mine.has(url)) ch.mine = true;
    ch.streams.push({ url, quality, geo: !!geo, not247: !!not247, headers: !!headers, ok: results[url]?.ok ?? null });
  }
  const pageIsHttps = location.protocol === 'https:';
  for (const ch of byId.values()) {
    // Meilleur flux d'abord : vérifié OK > lisible ici (https, sans en-têtes spéciaux) > qualité.
    const score = (s) => (s.ok === true ? 4 : s.ok === false ? -4 : 0) + (pageIsHttps && s.url.startsWith('http:') ? -2 : 0) + (s.headers ? -1 : 0);
    ch.streams.sort((a, b) => score(b) - score(a) || QUALITY(b.quality) - QUALITY(a.quality));
    ch.status = ch.streams.some((s) => s.ok) ? 'ok' : ch.streams.every((s) => s.ok === false) ? 'ko' : null;
    ch.geo = ch.streams.every((s) => s.geo);
    ch.quality = ch.streams.map((s) => s.quality).filter(Boolean).sort((a, b) => QUALITY(b) - QUALITY(a))[0] || null;
    ch.favorite = favorites.has(ch.channel) || favorites.has(ch.id);
    ch.group = groupOf(ch, ch.favorite ? new Set([ch.channel]) : null);
  }
  const channels = [...byId.values()].sort(
    (a, b) => (b.mine - a.mine) || GROUP_RANK(a.group) - GROUP_RANK(b.group) || a.group.localeCompare(b.group, 'fr') || a.name.localeCompare(b.name, 'fr'),
  );
  channels.forEach((c, i) => { c.lcn = i + 1; });
  return { channels, countries: raw.countries, languages: raw.languages, categories: raw.categories, generatedAt: raw.generatedAt, checkedAt: status?.checkedAt };
}

/** EPG allégé : { tvgId: [[débutMin, finMin, titre, catégorie, description]] } (minutes epoch). */
export async function loadEpg() {
  const raw = await getJSON('data/epg-now.json');
  return raw?.programmes || {};
}

export function nowNext(epg, id) {
  const list = epg[id] || epg[id.split('@')[0]];
  if (!list) return {};
  const now = Date.now() / 60000;
  const i = list.findIndex(([start, stop]) => start <= now && now < stop);
  if (i === -1) return { next: list.find(([start]) => start > now) };
  return { now: list[i], next: list[i + 1], progress: (now - list[i][0]) / (list[i][1] - list[i][0]) };
}

export const hhmm = (min) => new Date(min * 60000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function initials(name) {
  return name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** Construit un M3U côté navigateur à partir d'une liste de chaînes (meilleur flux de chacune). */
export function channelsToM3U(channels) {
  const esc = (s) => String(s ?? '').replace(/[\r\n"]+/g, ' ');
  const lines = ['#EXTM3U'];
  for (const c of channels) {
    const s = c.streams[0];
    lines.push(`#EXTINF:-1 tvg-id="${esc(c.id)}" tvg-logo="${esc(c.logo)}"${c.nsfw ? ' tvg-nsfw="1"' : ''} group-title="${esc(c.group)}",${esc(c.name)}`, esc(s.url));
  }
  return lines.join('\n') + '\n';
}
