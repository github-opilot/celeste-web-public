# Préparer Cloudflare Pages

État vérifié le 16 octobre 2026. Aucun projet Pages, bucket ou déploiement n’a été créé depuis ce dépôt.

Pour réutiliser un runtime amont sans le reconstruire et connaître les limites de compatibilité/licence des releases disponibles, voir [la note de distribution du runtime](runtime-distribution.md).

## Build Pages

`wrangler.toml` déclare le projet `celeste-web-public` et `pages_build_output_dir = "./dist"`. Pour empêcher des artefacts ignorés d’un ancien build complet de fuiter depuis un cache ou une copie de travail réutilisée, nettoie `dist/` avant le build :

```sh
npm ci && make clean && make build-sdk
```

Cette commande a été exécutée dans une archive propre de `HEAD` (`c85f891`), sans `.env.local`, `.tmp`, `dist` ni `node_modules` préexistants. Elle produit `dist/` : SDK TypeScript, manifeste et interface. Elle ne compile ni ne télécharge le runtime, ni Everest. Aucun fichier de cette sortie ne dépasse 25 MiB, limite Pages par fichier. Le workflow GitHub Actions utilise Node.js 24; définir `NODE_VERSION=24` dans Pages aligne les environnements.

Le build Pages ne doit pas embarquer le runtime. Dans le Codespace, `dist/` contient aussi des artefacts ignorés provenant d’un build complet; ils sont absents d’un clone propre, mais `make build-sdk` seul ne les supprime pas. `make clean` est donc important avant le build Pages.

L’aperçu local utilise `make preview PORT=8031`. `scripts/preview-server.py` fournit les mêmes en-têtes d’isolation et le MIME `application/wasm` pour les fichiers `.wasm` et `.wasmN`. Le SDK réassemble les morceaux du runtime dans un flux marqué `application/wasm`.

## Isolation, Workers et WebAssembly

`src/demo/_headers` est copié vers `dist/_headers` et applique à la page :

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: cross-origin`

Le SDK crée son Worker comme module (`new Worker(..., { type: 'module' })`). L’isolation autorise `SharedArrayBuffer`, requis par le runtime multithread. Le chargeur assemble les morceaux WASM puis passe un flux `application/wasm` à WebAssembly. Si le runtime est sur une autre origine, elle doit être en HTTPS, autoriser les requêtes navigateur par CORS et rendre les ressources compatibles avec COEP (par exemple `Cross-Origin-Resource-Policy: cross-origin`).

## Fichiers supérieurs à 25 MiB

Le clone propre suivi par Git et la sortie de `make build-sdk` ne contiennent aucun fichier supérieur à 25 MiB. Le build Pages n’émet aucun binaire de runtime.

Le Codespace contient toutefois des artefacts générés et ignorés par Git, absents du clone propre : `dist/celeste/everest.zip` mesure 71 996 436 octets (68,66 MiB), et `dist/celeste/_framework/` contient 216 fichiers totalisant 135 782 974 octets (129,49 MiB). Le runtime WASM y est réparti en cinq morceaux : `dotnet.native.vwx8rc7ccu.wasm0` à `.wasm4`, chacun sous 25 MiB. Les autres éléments comprennent 204 DLL, le glue JavaScript .NET, un worker module et trois fichiers ICU.

Le ZIP a 199 entrées, pèse 71 996 436 octets compressé et 190 382 046 octets décompressé. Il ne contient pas `Celeste.exe`, `Celeste.dll`, `Content/` ni les banques audio du jeu. `.tmp/everest-src/lib-stripped/Celeste.exe` est une assembly de référence dépouillée utilisée pour compiler Everest; elle n’est pas copiée dans `everest.zip`. Aucun fichier commercial du jeu ne doit être ajouté au bucket. **Correction de l’inventaire précédent :** le ZIP n’est pas un artefact MIT pur. Il contient aussi `fmod64.dll`, `fmodstudio64.dll`, `libfmod_SDL.so`, des bibliothèques Steamworks et Discord, ainsi que des exécutables MiniInstaller/Piton pour desktop. Il faut évaluer leurs licences séparément avant de distribuer l’archive.

Le ZIP Everest dépasse la limite Pages et ne peut donc pas être servi comme un asset Pages unique. Le `make build-sdk` propre n’en produit pas. Le runtime local est venu de MercuryWorkshop, mais son `runtime.json` indique la révision `70ab8ae24e0ea9f06bc9c9248278038a89cd2a59` alors que le script télécharge `/releases/download/latest/` sans vérifier l’asset contre cette révision. La page de release amont actuelle associe le tag `latest` au commit `b4b19eb`; l’origine exacte du binaire local reste donc à établir. Les prochains builds n’écriront plus la révision source comme s’il s’agissait de la révision du bundle précompilé. Pour une publication reproductible, utilise une révision source immuable ou un asset immuable avec SHA-256 vérifié.

L’arborescence runtime que le SDK sait charger est `https://<domaine-R2>/celeste/runtime.json`, `https://<domaine-R2>/celeste/everest.zip` et tous les objets de `https://<domaine-R2>/celeste/_framework/`. Les 216 fichiers `_framework/` et `everest.zip` sont nécessaires au chemin de démarrage par défaut (`installEverest: true`, source Everest intégrée). `everest.json` et `celeste-icon.png` ne sont pas lus au démarrage. Le SDK construit cette URL de base depuis `CELESTE_RUNTIME_BASE_URL`; aucune modification de la logique d’import du ZIP joueur ou de Supabase n’est nécessaire. Le `runtime.json` généré inclut le nombre attendu de morceaux WASM; le chargeur signalera explicitement un morceau manquant ou un échec réseau au lieu de compiler silencieusement un flux tronqué.

Un artefact de plus de 25 MiB qui est redistribuable peut être hébergé séparément en HTTPS (par exemple dans R2). La licence MIT couvre Everest lui-même, mais ne vaut pas autorisation pour les binaires tiers inclus dans le ZIP. L’inventaire réel du ZIP local trouve FMOD, les redistribuables Steamworks, le SDK Discord et plusieurs exécutables d’installation desktop. Les conditions FMOD limitent sa distribution à une application produit intégrée et excluent la distribution comme moteur/boîte à outils; les conditions Valve pour Steamworks prévoient les binaires redistribuables avec le logiciel du licencié; celles de Discord prévoient le SDK intégré à une application. Le ZIP complet ne contient pas les notices/licences de ces composants.

Le runtime `_framework` contient effectivement les assemblies .NET (`System.*`), `FNA.dll`, MonoMod/Mono.Cecil/NLua, `SteamKit2.dll` (LGPL-2.1) et `DepotDownloader.dll` (GPL-2.0 dans le projet amont). Les composants .NET sont sous MIT, FNA sous Ms-PL, FNA3D/FAudio/SDL3/MojoShader sous licences permissives dont zlib, et MonoMod sous MIT; FMOD est lié statiquement au WASM. Les binaires C# et natifs exigent l’inclusion des notices/licences et le respect des conditions propres à chaque composant. `_framework/` n’embarque pas ces fichiers de licence ni un SBOM complet, et le dépôt amont ne déclare pas de licence générale du bundle compilé. La licence publique FMOD exclut la distribution de FMOD comme moteur ou boîte à outils sans les droits correspondants. Les deux artefacts complets restent bloqués jusqu’à permission/validation écrite des droits propriétaires et production d’un paquet avec inventaire et avis tiers complets.

Pour un bucket public derrière un domaine HTTPS personnalisé, le modèle de règle est dans [`r2-cors.example.json`](r2-cors.example.json). Remplace ses origines d’exemple par le domaine Pages de production et, si nécessaire, le domaine Pages Preview. La page Pages garde COOP `same-origin` et COEP `require-corp`; les modules et téléchargements runtime inter-origines doivent réussir en CORS. La règle R2 autorise uniquement GET/HEAD et n’utilise aucun credential. Elle ne déploie ni ne configure le bucket. Les types de contenu recommandés sont : `.wasm0`–`.wasm4` → `application/wasm`; `.js`/`.mjs` → `text/javascript`; `.dll`/`.dat` → `application/octet-stream`; `runtime.json` → `application/json`; `everest.zip` → `application/zip`. Le SDK réassemble les morceaux WASM dans un flux `application/wasm`.

Les fichiers R2 actuels ne sont pas vérifiés à distance : aucun envoi ni accès au bucket n’a été fait. L’inventaire exact de la copie locale peut être régénéré avec `find dist/celeste/_framework -type f -printf '%s %p\n' | sort` après chaque build autorisé. Le seul ensemble candidat au chemin de démarrage complet est `runtime.json`, `everest.zip` et les 216 objets de `_framework/`; aucun n’est autorisé à l’envoi à ce stade. Exclure le jeu fourni par le joueur, `.tmp/`, l’archive `webleste-loader.tar.zst`, l’interface upstream et ses assets/analytics. Voir les [tarifs R2 actuels](https://developers.cloudflare.com/r2/pricing/).

Cette stratégie n’autorise pas la redistribution. L’audit FMOD et l’absence de licence générale identifiée pour le bundle amont bloquent actuellement la publication de tout runtime qui les inclut, dans Pages, R2 ou GitHub Releases. Ne copie aucun binaire avant une autorisation claire et un audit des licences incluses dans l’artefact précis.

## Variables intégrées au frontend

Dans les variables de **build** du projet Pages, renseigne uniquement après validation :

- `SUPABASE_URL` : URL HTTPS du projet Supabase existant.
- `SUPABASE_PUBLISHABLE_KEY` : clé publiable `sb_publishable_`.
- `CELESTE_RUNTIME_BASE_URL` : URL HTTPS publique vers les ressources runtime approuvées, avec `/celeste/` si le bucket reproduit cette arborescence.

Le build propre réussit sans aucune variable d’environnement. Le script exige les deux valeurs Supabase ensemble, refuse une clé qui n’est pas `sb_publishable_` et intègre ces valeurs dans les bundles navigateur. Elles sont donc publiques par conception. N’ajoute jamais `service_role`, `sb_secret_`, mot de passe ou jeton à Pages. Sans variables Supabase, les fonctions cloud ne sont pas configurées. Sans runtime co-localisé ou `CELESTE_RUNTIME_BASE_URL`, le site peut afficher l’interface mais ne peut pas démarrer le jeu.

Dans le Codespace actuel, `node scripts/audit-public-tree.mjs` signale le `.env.local` local, bien qu’il soit ignoré par Git et absent de l’archive propre testée. Ce signal concerne la copie de travail; il n’est pas reproduit dans le clone GitHub et ne doit pas conduire à publier ce fichier.

## Étapes de mise en ligne après levée des blocages

1. Conserve le dépôt privé pendant la revue de licence et jusqu’à ta décision de le rendre public.
2. Obtiens une confirmation écrite des auteurs du runtime amont et de Firelight Technologies, ou remplace le runtime par une version dont chaque composant est redistribuable dans ce contexte.
3. Vérifie chaque binaire final, crée sa liste de composants et joins les licences, attributions et crédits obligatoires. N’inclus aucun ZIP de Celeste.
4. Si un artefact légal dépasse 25 MiB, téléverse uniquement cet artefact vers un stockage HTTPS séparé; vérifie CORS, CORP et son coût prévisible.
5. Connecte le dépôt privé à un projet Cloudflare Pages, branche de production `main`, commande `npm ci && make clean && make build-sdk`, sortie `dist`.
6. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et, seulement si le runtime a été autorisé et hébergé, `CELESTE_RUNTIME_BASE_URL` dans les variables de build.
7. Ouvre un déploiement Preview HTTPS. Vérifie `crossOriginIsolated === true`, l’import local, le tutoriel, OPFS, le chargement du runtime, OAuth et les sauvegardes cloud. Ajoute ensuite l’URL Pages exacte aux Redirect URLs Supabase.
8. Après cette revue, décide séparément si tu rends le dépôt GitHub public et si tu actives la branche `main` pour la production Pages.

Tests depuis un clone Git propre : `make test` passe avec 157 tests réussis, zéro échec et 2 tests réels de présence d’installation Celeste ignorés (aucune copie du jeu n’est fournie). `node scripts/audit-public-tree.mjs` passe dans ce clone. Aucun test de démarrage complet en HTTPS n’est possible sans URL R2 et ZIP légitime fourni par un joueur. Le dépôt contient un workflow GitHub Actions de build et test, mais aucun workflow de déploiement. Aucun push, changement de visibilité, configuration distante ou transfert R2 n’a été déclenché ici.
