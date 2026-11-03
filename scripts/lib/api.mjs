// Accès à l'API iptv-org + jointure des données en un « catalogue » plat.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PUBLIC = join(ROOT, 'public');
export const DATA = join(PUBLIC, 'data');

// iptv-org.github.io/api est la source officielle ; raw.githubusercontent.com sert de secours
// (même contenu, branche gh-pages). Surcharge possible via IPTV_API_BASE.
const BASES = process.env.IPTV_API_BASE
  ? [process.env.IPTV_API_BASE]
  : ['https://iptv-org.github.io/api', 'https://raw.githubusercontent.com/iptv-org/api/gh-pages'];
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_TTL_MS = 6 * 3600 * 1000;

export async function fetchJSON(name) {
  const file = join(CACHE_DIR, `${name}.json`);
  try {
    const s = await stat(file);
    if (Date.now() - s.mtimeMs < CACHE_TTL_MS) return JSON.parse(await readFile(file, 'utf8'));
  } catch { /* pas de cache */ }
  let lastErr;
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}/${name}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${base}/${name}.json`);
      const text = await res.text();
      const data = JSON.parse(text);
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, text);
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export async function loadConfig() {
  return JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
}

export async function writeJSON(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

export async function readJSONIfExists(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/** Vrai si le module est lancé directement (`node scripts/x.mjs`), robuste aux espaces/accents dans le chemin. */
export const isMain = (metaUrl) => !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;

/** Identifiant stable d'un flux, aussi utilisé comme tvg-id (format iptv-org « chaine@feed »). */
export const tvgId = (channel, feed) => (feed ? `${channel}@${feed}` : channel);

function pickLogo(logos, feed) {
  if (!logos?.length) return null;
  const score = (l) =>
    (l.feed === feed ? 4 : l.feed == null ? 2 : 0) + (l.in_use ? 2 : 0) +
    (l.format === 'PNG' || l.format === 'SVG' ? 1 : 0) + Math.min(l.width || 0, 512) / 1024;
  return [...logos].sort((a, b) => score(b) - score(a))[0].url;
}

/**
 * Charge l'API et renvoie le catalogue complet : un objet par flux, enrichi des infos chaîne/feed/logo.
 * Les flux sans chaîne connue (channel=null) sont ignorés : pas de pays/catégorie/EPG possibles.
 */
export async function loadCatalog() {
  const [channels, streams, feeds, logos, countries, categories, languages] = await Promise.all(
    ['channels', 'streams', 'feeds', 'logos', 'countries', 'categories', 'languages'].map(fetchJSON),
  );
  const chById = new Map(channels.map((c) => [c.id, c]));
  const feedByKey = new Map(feeds.map((f) => [`${f.channel}@${f.id}`, f]));
  const mainFeed = new Map(feeds.filter((f) => f.is_main).map((f) => [f.channel, f]));
  const logosByCh = new Map();
  for (const l of logos) {
    if (!logosByCh.has(l.channel)) logosByCh.set(l.channel, []);
    logosByCh.get(l.channel).push(l);
  }

  const seen = new Set();
  const entries = [];
  for (const s of streams) {
    const ch = chById.get(s.channel);
    if (!ch || ch.closed || seen.has(s.url)) continue;
    seen.add(s.url);
    const ownFeed = s.feed ? feedByKey.get(`${ch.id}@${s.feed}`) : null;
    const feed = ownFeed || mainFeed.get(ch.id) || null;
    let name = clean(s.title || ch.name);
    // Distingue les variantes d'une même chaîne (ex. France 24 English / French).
    if (ownFeed && !ownFeed.is_main && !name.toLowerCase().includes(ownFeed.name.toLowerCase())) name += ` ${ownFeed.name}`;
    entries.push({
      id: tvgId(ch.id, s.feed),
      channel: ch.id,
      feed: s.feed || null,
      name,
      country: ch.country,
      categories: ch.categories?.length ? ch.categories : ['general'],
      languages: feed?.languages || [],
      nsfw: !!ch.is_nsfw || (ch.categories || []).includes('xxx'),
      logo: pickLogo(logosByCh.get(ch.id), s.feed),
      url: s.url,
      quality: s.quality || null,
      labels: s.labels || [],
      referrer: s.referrer || null,
      userAgent: s.user_agent || null,
    });
  }
  return { entries, countries, categories, languages };
}

/** Supprime retours à la ligne et guillemets qui casseraient une ligne #EXTINF. */
export function clean(str) {
  return String(str ?? '').replace(/[\r\n\t]+/g, ' ').replace(/"/g, "'").trim();
}

/** Applique les filtres de config.json. `nsfwMode` surcharge config.nsfw si fourni. */
export function filterEntries(entries, cfg, { nsfwMode = cfg.nsfw ?? 'tag', status = null } = {}) {
  const countries = new Set(cfg.countries || []);
  const langs = new Set(cfg.languages || []);
  const cats = new Set(cfg.categories || []);
  const exCats = new Set(cfg.excludeCategories || []);
  const exCh = new Set(cfg.excludeChannels || []);
  const favs = new Set(cfg.favorites || []);
  return entries.filter((e) => {
    if (exCh.has(e.channel)) return false;
    if (nsfwMode === 'exclude' && e.nsfw) return false;
    if (nsfwMode === 'only' && !e.nsfw) return false;
    if (cfg.excludeGeoBlocked && e.labels.includes('Geo-blocked')) return false;
    if (status && cfg.excludeDead && isDead(e, status[e.url])) return false;
    if (favs.has(e.channel)) return true; // un favori passe toujours les filtres pays/catégorie
    const geo = (!countries.size && !langs.size) || countries.has(e.country) || e.languages.some((l) => langs.has(l));
    if (!geo) return false;
    if (e.nsfw) return true; // les chaînes adultes ne sont pas soumises aux filtres de catégorie
    if (e.categories.every((c) => exCats.has(c))) return false;
    return !cats.size || e.categories.some((c) => cats.has(c));
  });
}

/**
 * Un flux n'est « mort » que si l'échec n'est pas dû à la géolocalisation du vérificateur
 * (runner GitHub aux États-Unis) : flux étiqueté géo-bloqué, ou réponse 403/451, on le garde.
 */
export function isDead(e, r) {
  if (!r || r.ok !== false) return false;
  if (e.labels.includes('Geo-blocked') || r.code === 403 || r.code === 451) return false;
  return true;
}

/** Charge status.json s'il est fiable (assez de flux OK) — protège contre une panne réseau qui viderait la playlist. */
export async function loadTrustedStatus() {
  const st = await readJSONIfExists(join(DATA, 'status.json'));
  if (!st?.results) return null;
  const vals = Object.values(st.results).filter((r) => r.ok !== null);
  const okRatio = vals.length ? vals.filter((r) => r.ok).length / vals.length : 0;
  if (okRatio < 0.15) {
    console.warn(`⚠ status.json ignoré : seulement ${(okRatio * 100).toFixed(0)}% de flux OK (panne réseau probable)`);
    return null;
  }
  return st.results;
}
