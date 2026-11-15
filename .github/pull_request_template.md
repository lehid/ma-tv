## Quoi et pourquoi

<!-- Ce que change cette PR, et le problème qu'elle règle. -->

## Comment tester

<!-- Les étapes pour vérifier : page à ouvrir, chaîne à lancer, touche à presser… -->

- [ ] Captures d'écran jointes si l'interface change (ordinateur + mobile, sombre et clair si possible)

## Vérifications

- [ ] `npm test` et `npm run build` passent (la CI les relance)
- [ ] Interface modifiée : `npm run e2e` passe (navigation télécommande + Chromecast)
- [ ] Compatible avec les navigateurs de TV : pas d'API récente sans repli, build `es2017`
- [ ] Tout texte injecté dans le HTML passe par `esc()`
- [ ] Couleurs uniquement via les tokens CSS de `web/src/style.css`
- [ ] Chaînes adultes toujours taguées, jamais supprimées en silence
- [ ] Sélection de chaînes modifiée seulement dans `config.json` (jamais dans les fichiers générés)
