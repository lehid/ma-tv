# Applis Smart TV « coquilles »

Ces deux mini-applis mettent une icône **Ma TV** sur l'écran d'accueil d'une TV Samsung (Tizen) ou LG (webOS). Au lancement, elles ouvrent en plein écran le site hébergé (`siteUrl` de [`config.json`](../config.json), par défaut `https://lehid.github.io/ma-tv/`).

Elles ne contiennent pas le lecteur : chaque mise à jour du site est donc visible sur la TV sans rien réinstaller.

| Dossier | Contenu |
|---|---|
| `tizen/` | `config.xml` (profil `tv-samsung`, Tizen 5.0+), `index.html`, `icon.png` (512×423) |
| `webos/` | `appinfo.json`, `index.html`, `icon.png` (80×80), `largeIcon.png` (130×130) |

## Comment ça marche

- **Redirection plutôt qu'iframe.** `index.html` fait `location.replace(siteUrl)` : le site devient la page principale. Il reçoit donc directement les touches de la télécommande, le plein écran vidéo fonctionne et l'API `tizen.*` reste accessible. Avec un iframe, le focus et les touches restent souvent bloqués sur la page parente.
- **Touches.** Le code vit côté site, dans `web/src/tv-app.js`, et ne fait rien hors TV :
  - **Samsung** : enregistrement de CH+/CH−, des chiffres 0-9 et des touches Lecture/Pause/Stop via `tizen.tvinputdevice.registerKeyBatch` (filtré par `getSupportedKeys()`) ;
  - **LG** : webOS envoie ces touches sans enregistrement.
- **Retour.** Il ferme le lecteur s'il est ouvert. Sur la page d'accueil, il quitte l'appli (`tizen.application.getCurrentApplication().exit()` sur Samsung, `window.close()` sur LG, grâce à `disableBackHistoryAPI: true`). Sur Guide et Stats, il revient à la page précédente.
- **L'URL du site** n'est écrite qu'à un endroit, `config.json` → `siteUrl`. Les fichiers de `tv-apps/` contiennent les marqueurs `__SITE_URL__` et `__SITE_HOST__`, remplacés au packaging.

## Préparer les archives

```bash
npm run tv:package
```

Le script produit des archives **non signées** dans `dist-tv/` (ignoré par git) :

- `dist-tv/tizen/` et `dist-tv/ma-tv-tizen.wgt` ;
- `dist-tv/webos/` (dossier prêt pour `ares-package`) et `dist-tv/ma-tv-webos.zip`.

Pour régénérer les icônes depuis `public/icon.svg` (Playwright + Chromium nécessaires) :

```bash
npm run tv:icons
```

## Ce qui exige un compte développeur

| Étape | Samsung | LG |
|---|---|---|
| Compte | **Compte Samsung** (gratuit), pour le certificat auteur + distributeur | **Compte LG Developer** (gratuit), pour l'appli *Developer Mode* |
| Mode développeur sur la TV | Oui, sans compte (code dans *Apps*) | Oui, via l'appli *Developer Mode* connectée au compte LG |
| Durée | Le certificat distributeur est lié au DUID de la TV | La session dure 1 000 h, à prolonger dans l'appli |

Aucun de ces comptes n'est payant, et rien n'est publié sur un store : l'appli reste installée en « développeur » sur ta TV.

## Samsung (Tizen), pas à pas

1. **Installer les outils sur le PC.** Installe [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) (version CLI suffisante). Dans le *Package Manager*, installe :
   - *Extension SDK* → **Samsung Certificate Extension** ;
   - **TV Extensions** (dernière version).

   La CLI `tizen` et `sdb` se trouvent ensuite dans `~/tizen-studio/tools/ide/bin` et `~/tizen-studio/tools`.
2. **Activer le mode développeur sur la TV.**
   1. Ouvre *Apps*, puis tape `1 2 3 4 5` à la télécommande.
   2. Passe *Developer mode* sur **On** et saisis l'**IP du PC**.
   3. Redémarre la TV, puis note son IP (*Paramètres → Général → Réseau → État*).
3. **Connecter le PC à la TV.**
   ```bash
   sdb connect <IP_TV>
   sdb devices        # doit lister la TV ; note son nom (ex. UE55…)
   ```
4. **Créer le certificat Samsung** (*compte Samsung requis*). Dans Tizen Studio, ouvre *Tools → Certificate Manager → + → Samsung*, profil **TV** :
   - nouveau certificat auteur ;
   - certificat distributeur **Privilege: Public**, avec le DUID de la TV (ajouté automatiquement si elle est connectée via `sdb`).

   Nomme le profil, par exemple `matv`.
5. **Packager et signer.**
   ```bash
   npm run tv:package
   tizen package -t wgt -s matv -- dist-tv/tizen
   ```
   Cette commande produit `dist-tv/tizen/Ma TV.wgt`, signé. Le fichier `dist-tv/ma-tv-tizen.wgt` non signé ne s'installe pas tel quel : il sert de copie de contrôle.
6. **Installer et lancer.**
   ```bash
   tizen install -n "Ma TV.wgt" -s <IP_TV>:26101 -- dist-tv/tizen
   tizen run -p MaTVlehid1.MaTV -s <IP_TV>:26101
   ```
   L'icône **Ma TV** apparaît dans *Apps* ; tu peux l'épingler sur l'écran d'accueil.

## LG (webOS), pas à pas

1. **Créer un compte LG Developer** sur [webostv.developer.lge.com](https://webostv.developer.lge.com/) (*compte requis*).
2. **Activer le mode développeur sur la TV.**
   1. Depuis le *LG Content Store*, installe l'appli **Developer Mode**.
   2. Connecte-toi avec le compte LG Developer.
   3. Passe *Dev Mode Status* sur **On** (la TV redémarre), puis active **Key Server**.
   4. Note l'**IP** et la **passphrase** affichées.
3. **Installer le webOS CLI sur le PC.**
   ```bash
   npm i -g @webos-tools/cli
   ```
4. **Déclarer la TV.**
   ```bash
   ares-setup-device --add matv -i "host=<IP_TV>" -i "port=9922" -i "username=prisoner"
   ares-novacom --device matv --getkey     # saisir la passphrase affichée sur la TV
   ares-device --device matv --system-info # test de connexion
   ```
5. **Packager, installer et lancer.**
   ```bash
   npm run tv:package
   ares-package dist-tv/webos -o dist-tv   # → dist-tv/io.github.lehid.matv_1.0.0_all.ipk
   ares-install --device matv dist-tv/io.github.lehid.matv_1.0.0_all.ipk
   ares-launch --device matv io.github.lehid.matv
   ```
   L'icône **Ma TV** apparaît dans la barre d'applis.
6. **Prolonger la session.** Le mode développeur expire au bout de 1 000 h (l'appli est alors désinstallée). Ouvre l'appli *Developer Mode* et clique *Extend* de temps en temps.

## Dépannage

- **Écran « Chargement de Ma TV… » figé** : la TV n'a pas de connexion, ou `siteUrl` est faux. Appuie sur OK pour réessayer.
- **CH+/CH− ou les chiffres ne répondent pas (Samsung)** : le firmware n'expose pas `tizen.tvinputdevice` au site distant. Les flèches, OK et Retour marchent toujours, et ▲▼ zappent dans le lecteur.
- **Changer d'adresse** : modifie `siteUrl` dans `config.json`, puis relance `npm run tv:package` et réinstalle.
