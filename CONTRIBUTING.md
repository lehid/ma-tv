# Contribuer à Ma TV

Bienvenue ! Ce guide te permet de lancer le projet en local, de tester tes changements et de les proposer.

## Démarrer

Il faut Node 20 ou plus récent.

```bash
git clone https://github.com/lehid/ma-tv.git
```

```bash
cd ma-tv
```

```bash
npm install
```

Récupère les données (catalogue iptv-org, playlists, stats) :

```bash
npm run data
```

Lance le site :

```bash
npm run dev
```

Le site s'ouvre sur http://localhost:5173. Il est aussi accessible depuis une TV ou un téléphone sur le même Wi-Fi, à l'adresse affichée dans le terminal.

## Comprendre le projet

- Le [README](README.md) explique ce que fait le projet et donne le schéma des données.
- [CLAUDE.md](CLAUDE.md) décrit l'architecture, les fichiers clés et les conventions.
- La sélection de chaînes se règle uniquement dans [`config.json`](config.json). Les playlists, le guide et le site en découlent.

## Tester

Tests unitaires :

```bash
npm test
```

Tests de bout en bout : navigation à la télécommande et Chromecast simulé. La première fois, installe le navigateur de test :

```bash
npx playwright install chromium
```

Puis construis le site et lance l'aperçu :

```bash
npm run build && npm run preview:e2e
```

Dans un autre terminal :

```bash
npm run e2e
```

La CI relance tout cela sur chaque pull request.

## Proposer un changement

1. Crée une branche par sujet, par exemple `feat/sous-titres` ou `fix/son-iphone`.
2. Fais des commits courts, avec des messages en français qui disent ce qui change.
3. Pousse ta branche et ouvre une pull request vers `main`, en remplissant le modèle.
4. Attends que la CI (« Tests (PR) ») soit verte avant de fusionner.
5. Une fusion dans `main` **publie automatiquement le site** sur https://lehid.github.io/ma-tv/. Le site est aussi régénéré chaque nuit.

## Règles importantes

- **TV d'abord.** Le site doit marcher sur de vieux navigateurs de TV : build `es2017`, pas d'API récente sans repli, et tout doit rester utilisable aux flèches, OK et Retour.
- **Sécurité.** Tout texte injecté dans le HTML passe par `esc()`.
- **Couleurs.** Uniquement via les tokens CSS de `web/src/style.css`, en sombre et en clair.
- **Chaînes adultes.** Elles restent taguées (`18+`), jamais supprimées en silence.
- **Ne commite pas** les fichiers générés (`public/data/*.json`, `public/*.m3u`, `dist/`, `epg/channels.xml`), ni aucun secret.

## Avec Claude Code

Si tu utilises Claude Code, `CLAUDE.md` et les skills du projet sont chargés automatiquement. Par exemple, le skill `ma-tv-playlist` modifie la sélection de chaînes quand tu lui demandes « ajoute France 2 aux favoris ».
