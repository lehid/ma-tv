---
name: ma-tv-playlist
description: Modifier la sélection de chaînes de Ma TV en langage naturel (« ajoute France 2 aux favoris », « retire le téléachat », « ajoute le Sénégal », « masque les chaînes adultes ») puis régénérer et vérifier les playlists. À utiliser pour toute demande qui touche config.json, les favoris, les pays/langues/catégories ou la playlist M3U.
---

# Gérer la sélection Ma TV

`config.json` est la seule source de vérité : les playlists, le guide et le site en dérivent.

## Étapes

1. **Trouver les identifiants**, qui ne s'inventent pas. Charge le catalogue :
   ```bash
   node -e "import('./scripts/lib/api.mjs').then(async m=>{const {entries}=await m.loadCatalog();const q=process.argv[1].toLowerCase();for(const e of entries.filter(e=>e.name.toLowerCase().includes(q)).slice(0,20))console.log(e.channel,'|',e.id,'|',e.name,'|',e.country,'|',e.categories.join(','),e.nsfw?'| 🔞':'')})" "france 2"
   ```
   - Pays : code ISO alpha-2, sauf le Royaume-Uni, qui est `UK`.
   - Langues : ISO 639-3 (`fra`, `ara`, `eng`, `wol`…).
   - Catégories : voir `web/src/labels.js`.
2. **Modifier `config.json`** avec Edit, sans toucher aux autres clés :
   - favoris → `favorites` (id de chaîne, ex. `France2.fr`) ;
   - pays / langues → `countries` / `languages` ;
   - retirer une catégorie → `excludeCategories` ; retirer une chaîne → `excludeChannels` ;
   - chaînes adultes : `nsfw` = `tag` (incluses, groupe 🔞 Adulte), `exclude` ou `only`.
3. **Régénérer et contrôler** :
   ```bash
   npm test && npm run playlist && npm run epg:channels
   ```
   Vérifie que le nombre de flux évolue dans le bon sens, puis cherche la chaîne concernée :
   `grep -n "tvg-name=\"France 2" public/playlist.m3u`.
4. **Résumer** à l'utilisateur ce qui a changé (nombre de flux avant/après), puis proposer de commit et push. C'est l'Action GitHub qui republie le site et les URLs de la TV.

## À ne pas faire

- Ne jamais éditer les fichiers générés (`public/*.m3u`, `public/data/*.json`, `epg/channels.xml`).
- Ne pas désactiver `excludeDead` pour « récupérer » une chaîne. Si un flux est mort, cherche un autre id ou feed.
