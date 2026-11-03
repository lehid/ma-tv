# Ma TV

Lecteur web + playlists M3U + guide TV + stats, construits à partir de l'API publique iptv-org et publiés sur GitHub Pages par `.github/workflows/daily.yml` (chaque nuit).

## Commandes
- `npm test` : tests unitaires (`node --test`, fichiers `scripts/**/*.test.mjs`)
- `npm run check` : vérifie les flux de la sélection → `public/data/status.json`
- `npm run data` : playlist → epg:channels → epg:now → stats
- `npm run dev` / `npm run build` : site Vite (racine `web/`, publicDir `public/`, sortie `dist/`)

## Architecture
- `scripts/lib/api.mjs` : `fetchJSON` (cache `.cache/`, 6 h, avec repli sur raw.githubusercontent), `loadCatalog()` (un objet par flux, avec chaîne, feed et logo joints), `filterEntries()` (règles de `config.json`), `loadTrustedStatus()` (ignore un status.json dont moins de 15 % des flux sont OK)
- `scripts/lib/m3u.mjs` : génération M3U ; tout texte passe par `clean()` (anti-injection de lignes)
- `web/src/labels.js` : libellés FR et groupes, partagés par Node et le navigateur
- `web/src/data.js` : décode `data/channels.json` (format tableau, voir `build-playlist.mjs`), regroupe les flux par tvg-id
- `tv-apps/` : coquilles Tizen/webOS qui redirigent vers `siteUrl` ; `npm run tv:package` → `dist-tv/` ; touches TV et sortie d'appli dans `web/src/tv-app.js`
- `web/src/tv-nav.js` : navigation spatiale à la télécommande ; `player.js` : hls.js chargé à la demande, avec repli flux par flux

## Conventions
- tvg-id = `chaine@feed` (format iptv-org), identique dans la playlist, `epg/channels.xml` et `epg-now.json`
- Chaînes adultes : jamais supprimées en silence, toujours taguées (`nsfw`, groupe `🔞 Adulte`, `tvg-nsfw="1"`)
- Fichiers générés ignorés par git : `public/*.m3u`, `public/data/*.json`, `public/guide.xml*`, `epg/channels.xml`
- Le site doit fonctionner sur les navigateurs de TV : build `es2017`, pas d'API récente sans repli, tout le texte injecté dans le HTML passe par `esc()`
- Couleurs : uniquement via les tokens CSS de `web/src/style.css` (sombre par défaut, avec un thème clair)
- Pour modifier la sélection de chaînes, utiliser le skill `.claude/skills/ma-tv-playlist`
