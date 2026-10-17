# Distribution du runtime Celeste WebAssembly

État vérifié le 17 octobre 2026. Cette note décrit la réutilisation des artefacts amont et le contrat technique du SDK. Elle ne donne aucune autorisation de republier des binaires.

## Releases publiques et format

- MercuryWorkshop publie une release continue, tag mutable `latest`, actuellement basée sur le commit `b4b19eb` : [release Continuous Build](https://github.com/MercuryWorkshop/celeste-wasm/releases/tag/latest). Le dépôt annonce une archive `webleste-loader.tar.zst`; cette archive doit être extraite avant hébergement. Ce n’est pas une URL de runtime utilisable directement dans `runtimeBaseUrl`.
- La release [v0.9 Singlethreaded AOT](https://github.com/MercuryWorkshop/celeste-wasm/releases/tag/v0.9) est explicitement marquée legacy et singlethreaded. Elle n’est pas le choix à intégrer à ce SDK, qui vérifie l’isolation cross-origin et démarre un runtime WebAssembly threaded.
- Le dépôt [wasm-gaming/celeste-wasm](https://github.com/wasm-gaming/celeste-wasm) décrit la séparation SDK/runtime et l’option `runtimeBaseUrl`. Sa page GitHub n’affiche actuellement aucune release publiée; le README indique où les artefacts devraient être publiés, pas qu’un binaire précis est disponible.

La release Mercury `latest` est un candidat technique à vérifier, pas une dépendance épinglée. Le tag peut avancer. Pour chaque artefact, il faut enregistrer l’URL exacte, le commit amont, la date de récupération, le nom, la taille et le SHA-256. La révision `RUNTIME_REV` de ce projet ne prouve pas l’origine d’un téléchargement effectué depuis le tag `latest`.

## Contrat attendu par ce SDK

Le SDK local implémente déjà le contrat de type `wasm-gaming/celeste-wasm` : `options.runtimeBaseUrl` et la variable de build `CELESTE_RUNTIME_BASE_URL` désignent la racine HTTP(S) du répertoire runtime. À partir de cette racine, il demande notamment :

```text
runtime.json
everest.zip
_framework/dotnet.js
_framework/dotnet.runtime.*.js
_framework/dotnet.native.*.js
_framework/dotnet.native.worker.*.mjs
_framework/dotnet.native.*.wasm0 ... wasmN
_framework/*.dll
_framework/*.dat
```

Le runtime amont garde Celeste à la racine de son OPFS. Si `runtime.json` n’existe pas, ce SDK utilise ce format historique; s’il existe, son `storageNamespace` doit décrire le binaire réellement servi. Un manifeste falsifié ou copié d’un autre build peut envoyer l’import ZIP dans un répertoire que le runtime ne lit pas.

La compatibilité est conditionnelle au runtime précis. Le chargeur attend l’API .NET WebAssembly et les exports `CelesteLoader`/`Patcher`, les modifications de worker/canvas et le format WASM segmenté. Le script local `scripts/verify-runtime.mjs` vérifie plusieurs de ces attentes après installation d’un bundle. Le SDK prend aussi en charge les anciens runtimes sans le champ `nativeWasmParts`, mais cette compatibilité ne prouve pas qu’une nouvelle release Mercury conserve l’ABI. Après extraction d’une nouvelle release, il faut passer `verify-runtime.mjs`, les tests SDK, puis un essai navigateur complet.

Ne pointe pas `CELESTE_RUNTIME_BASE_URL` vers la page de release GitHub ni vers l’archive `.tar.zst` : l’option construit des URLs de fichiers individuels. Il faut d’abord extraire le bundle dans une origine HTTPS capable de servir l’arborescence ci-dessus, avec les bons en-têtes. Une release GitHub peut servir de source pour un build contrôlé; elle n’est pas elle-même un CDN de dossier pour ce SDK.

## Architecture Pages et R2

Pages ne sert que le dépôt propre :

```sh
npm ci && make clean && make build-sdk
```

Sortie : `dist/`. Dans Cloudflare Pages, renseigner `NODE_VERSION=24`, les variables existantes `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`, puis `CELESTE_RUNTIME_BASE_URL` une fois un runtime légalement approuvé et hébergé. Exemple de valeur : `https://static.example.org/celeste/`. Elle est intégrée au code navigateur au build; changer sa valeur demande un nouveau build. La clé Supabase publiable est visible au client, contrairement à toute clé secrète.

L’arborescence publique attendue est :

```text
https://static.example.org/celeste/runtime.json
https://static.example.org/celeste/everest.zip
https://static.example.org/celeste/_framework/...
```

Héberger cette arborescence sur R2 évite la limite Pages de 25 MiB par asset. Configurer CORS uniquement pour les origines Pages de production et de Preview, en GET/HEAD, sans credentials; la règle d’exemple est [`r2-cors.example.json`](r2-cors.example.json). Pages conserve COOP `same-origin` et COEP `require-corp`. Les modules JavaScript, téléchargements WASM et données runtime cross-origin doivent être servis en CORS; tout consommateur `no-cors` exige aussi une réponse CORP `cross-origin`. Vérifier `crossOriginIsolated === true`, le worker module et les types MIME après déploiement. Aucun paramètre Supabase ni chemin d’import ZIP n’a besoin de changer.

GitHub Releases peut garder les archives versionnées pour la provenance, mais l’URL de l’archive n’est pas la base `runtimeBaseUrl`. Pour une mise en service, extraire l’asset vérifié puis synchroniser les fichiers autorisés vers la structure R2, ou publier la même arborescence via un autre hôte statique. Ne pas déployer les archives `.zst` elles-mêmes à la place des fichiers runtime.

## Conditions de redistribution

La page du dépôt MercuryWorkshop ne présente pas de licence générale identifiable pour le port ou le bundle runtime. Le fait que son dépôt et sa release soient publics ne concède pas automatiquement un droit de miroir. Obtenir du mainteneur une autorisation écrite couvrant l’usage de l’artefact, le miroir sur R2 ou GitHub Releases, et les modifications/avis éventuellement nécessaires.

Le dépôt `wasm-gaming/celeste-wasm` place son code d’emballage sous MIT et documente séparément les dépendances du runtime. Cette licence MIT ne couvre pas les composants tiers. Les conditions officielles FMOD autorisent certains usages non commerciaux seulement lorsque FMOD Engine est intégré à une application, excluent sa distribution comme moteur ou boîte à outils, excluent la promotion/monétisation dans la voie non commerciale et imposent l’attribution. Ici FMOD est lié statiquement au WASM et le projet distribue un runtime de jeu; obtenir une confirmation écrite de Firelight Technologies avant de republier ce runtime. [Licence FMOD](https://www.fmod.com/legal)

Le runtime embarque aussi des composants sous licences propres, dont .NET, FNA, FAudio/FNA3D et des composants Steam. `NOTICE.md` du projet `wasm-gaming/celeste-wasm` doit accompagner l’examen, puis il faut faire un SBOM et fournir les notices des versions exactes présentes. Steamworks natif n’est pas nécessaire au chemin navigateur implémenté par ce SDK pour les succès : celui-ci répond aux imports Steam côté JavaScript. Cela ne rend pas automatiquement redistribuables les binaires Steamworks desktop contenus dans une archive Everest. Valve n’accorde dans son SDK que la redistribution des composants nommés `redistributable_bin` avec le logiciel du licencié; l’archive Everest desktop ne constitue pas à elle seule la preuve que ces conditions sont satisfaites. [Accord Steamworks](https://partner.steamgames.com/documentation/sdk_access_agreement/)

L’intégration Discord Rich Presence dépend du Game SDK. Les termes Discord limitent la redistribution de l’API/SDK à son inclusion comme partie intégrante d’une application; les binaires natifs inclus pour Windows/Linux/macOS ne sont pas requis par le worker WebAssembly. Il faut déterminer si l’assembly géré du SDK est nécessaire à l’assembly Everest précise, documenter la version et inclure le composant seulement selon les termes applicables. [Conditions développeur Discord 2017](https://support-dev.discord.com/hc/en-us/articles/25280443568791-2017-Discord-Developer-Terms-of-Service)

Celeste reste fourni par le joueur et son ZIP est importé localement. Il ne doit figurer ni dans Pages, ni dans R2, ni dans une release GitHub. Les fichiers FMOD du jeu restent eux aussi locaux avec l’installation personnelle.

## Étapes avant une release jouable

1. Demander aux mainteneurs MercuryWorkshop et wasm-gaming une confirmation de compatibilité et les droits nécessaires pour les fichiers qu’ils détiennent; demander à Firelight une réponse écrite pour le WASM FMOD intégré à ce portfolio.
2. Choisir une release Mercury précise et immuable, télécharger l’asset dans un espace de travail local, noter commit, URL, taille et SHA-256. Ne pas publier l’archive amont sans inventaire des composants et notices.
3. Extraire l’asset dans un répertoire temporaire; exécuter `node scripts/verify-runtime.mjs dist/celeste/_framework`, `make test` et l’inventaire de toutes les DLL/WASM/ressources. Générer le SBOM/notices pour le binaire exact.
4. Confirmer le runtime avec le ZIP Everest, lui aussi vérifié côté licences. Le ZIP de test ne doit pas inclure Celeste ni des redistribuables desktop non autorisés.
5. Copier uniquement les fichiers autorisés dans `celeste/runtime.json`, `celeste/everest.zip` et `celeste/_framework/` sur R2; enregistrer les empreintes et métadonnées MIME de chaque objet.
6. Configurer `CELESTE_RUNTIME_BASE_URL=https://<domaine-R2>/celeste/` dans les variables de build Pages et appliquer la politique CORS adaptée. COOP/COEP restent sur la page Pages.
7. Depuis un déploiement HTTPS Preview, importer une installation que le testeur possède et valider patch Everest, démarrage, image, audio, clavier/manette, OPFS et sauvegardes Supabase. Ne jamais envoyer l’installation ou les sauvegardes personnelles vers R2.

À cette date, l’intégration URL est déjà présente dans le SDK et le build Pages est indépendant du runtime. Aucune release runtime n’est déclarée ici prête à republier : les droits FMOD et l’autorisation de miroir du bundle amont restent à confirmer.
