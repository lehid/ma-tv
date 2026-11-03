# 📺 Ma TV

Mon lecteur TV perso, construit sur le catalogue public [iptv-org/iptv](https://github.com/iptv-org/iptv) :

- **Lecteur web** : grille de chaînes filtrable (pays, catégorie, langue, adulte, en ligne), favoris, numéros de chaîne à taper à la télécommande, zapping ▲▼.
- **Playlist M3U perso**, régénérée chaque nuit et filtrée selon [`config.json`](config.json), avec les flux morts retirés.
- **Guide TV (EPG)** : ce qui passe maintenant, ce soir, et la suite.
- **Stats** : carte du monde et répartitions par catégorie, langue et qualité.
- **Smart TV** : le site se pilote aux flèches + OK + Retour, et la playlist et le guide se branchent dans n'importe quelle appli IPTV.

Tout est statique, hébergé gratuitement sur GitHub Pages et mis à jour par une GitHub Action quotidienne.

## Les URLs à retenir

| Quoi | URL |
|---|---|
| Site (lecteur, guide, stats) | `https://lehid.github.io/ma-tv/` |
| Ma playlist | `https://lehid.github.io/ma-tv/playlist.m3u` |
| Ma playlist sans chaînes adultes | `https://lehid.github.io/ma-tv/playlist-sfw.m3u` |
| Playlist d'un seul pays | `https://lehid.github.io/ma-tv/playlist-fr.m3u` (`-be`, `-ch`, `-ca`, `-ma`…) |
| Guide TV (XMLTV) | `https://lehid.github.io/ma-tv/guide.xml.gz` |

## Sur la Smart TV

La playlist contient déjà l'adresse du guide (`url-tvg`), donc la plupart des applis le trouvent toutes seules.

- **Android TV / Google TV / Fire TV** : installe **TiviMate** (ou Televizo, IPTV Smarters), choisis *Ajouter une playlist → M3U*, colle l'URL de la playlist, puis, si l'appli le demande, celle du guide.
- **Samsung (Tizen)** et **LG (webOS)** : installe **SS IPTV**, *Smart IPTV* ou *Flix IPTV* depuis le store de la TV, puis ajoute la playlist par URL (certaines applis passent par leur site web pour la saisir).
- **Icône Ma TV sur l'écran d'accueil** (Samsung/LG, mode développeur) : voir [`tv-apps/`](tv-apps/README.md) et `npm run tv:package`.
- **Sans appli** : ouvre `https://lehid.github.io/ma-tv/` dans le navigateur de la TV.
  - Flèches pour naviguer, **OK** pour lancer une chaîne, **Retour** pour revenir.
  - **CH+ / CH−** ou ▲▼ pour zapper, et tu peux taper directement un numéro (`012`).
- **VLC / Kodi** : *Ouvrir un flux réseau* et colle l'URL de la playlist.

> Certaines chaînes ne marchent qu'avec une appli IPTV ou VLC : le navigateur bloque les flux en `http://` sur une page `https://`, ainsi que ceux qui refusent le CORS ou exigent un *referrer*. Le lecteur web essaie automatiquement les flux alternatifs.

## Personnaliser : `config.json`

| Clé | Effet |
|---|---|
| `countries` | codes pays retenus (`FR`, `BE`…). Attention : le Royaume-Uni est `UK` chez iptv-org |
| `languages` | codes langue ISO 639-3 (`fra`, `ara`, `eng`…). Une chaîne est retenue si son pays **ou** sa langue correspond |
| `categories` | si non vide, ne garde que ces catégories (`news`, `sports`, `movies`…) |
| `excludeCategories` / `excludeChannels` | exclusions (ex. `shop`, `religious`, ou un id comme `QVCFrance.fr`) |
| `favorites` | ids de chaînes (`France24.fr`) placés en tête, dans le groupe ⭐ Favoris |
| `nsfw` | `tag` (défaut : incluses dans le groupe `🔞 Adulte` avec l'attribut `tvg-nsfw="1"`), `exclude` ou `only` |
| `excludeGeoBlocked` | retire les flux marqués géo-bloqués |
| `excludeDead` | retire les flux qui ont échoué à la vérification de la nuit |
| `perCountryPlaylists` | génère aussi `playlist-<pays>.m3u` |
| `epg.preferredSites` | sources de programmes à privilégier |
| `epg.excludeSites` | sources à ne jamais utiliser (injoignables depuis GitHub Actions) |
| `siteUrl` | adresse publique du site (sert à écrire l'URL du guide dans la playlist) |

Les ids de chaînes se trouvent sur [iptv-org.github.io](https://iptv-org.github.io/) ou dans le lecteur (survol d'une tuile, attribut `data-id`).

Après un `git push` sur `config.json`, l'Action régénère tout.

## En local

```bash
npm install
```

```bash
npm run check      # vérifie les flux de ta sélection → public/data/status.json
```

```bash
npm run data       # playlists + liste EPG + epg-now.json + stats
```

```bash
npm run dev        # site sur http://localhost:5173 (accessible depuis la TV sur le même Wi-Fi)
```

```bash
npm test
```

## Comment ça marche

```
API iptv-org (JSON) ──► scripts/lib/api.mjs (jointure flux ⇄ chaînes ⇄ feeds ⇄ logos)
        │
        ├─► check-streams.mjs ─► data/status.json (flux OK / KO)
        ├─► build-playlist.mjs ─► playlist*.m3u + data/channels.json (catalogue compact du site)
        ├─► build-epg-channels.mjs ─► epg/channels.xml ─► grabber iptv-org/epg ─► guide.xml.gz
        │                                                     └─► build-epg-now.mjs ─► data/epg-now.json
        └─► build-stats.mjs ─► data/stats.json
web/ (Vite, JS vanilla) : index.html (lecteur) · guide.html · stats.html
```

## Chaînes adultes

Elles sont **incluses mais toujours identifiées** :
- dans la playlist, par le groupe `🔞 Adulte` et l'attribut `tvg-nsfw="1"` ;
- sur le site, par un badge 🔞 et un filtre *Afficher / Masquer / Uniquement* ;
- dans les stats, par une catégorie à part.

`playlist-sfw.m3u` n'en contient aucune, et `"nsfw": "exclude"` les retire partout.

## Mentions

Ce projet ne stocke ni ne rediffuse aucune vidéo : il pointe vers des flux publics recensés par iptv-org. Leur disponibilité et leurs restrictions géographiques dépendent des diffuseurs.

Licence MIT.
