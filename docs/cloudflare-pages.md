# Préparer Cloudflare Pages

État vérifié le 15 octobre 2026. Aucun projet Pages, bucket ou déploiement n’a été créé depuis ce dépôt.

## Build Pages

`wrangler.toml` déclare le projet `celeste-web-public` et `pages_build_output_dir = "./dist"`. La commande à inscrire dans les paramètres Build de Pages est :

```sh
npm ci && make build-sdk
```

Le build produit `dist/` : SDK TypeScript, manifeste et interface. Il ne compile ni ne télécharge le runtime, ni Everest. Pages Free accepte au plus 25 MiB par fichier. Les fichiers du build vérifié sont tous plus petits que cette limite.

L’aperçu local utilise `make preview PORT=8031`. `scripts/preview-server.py` fournit les mêmes en-têtes d’isolation et le MIME `application/wasm` pour les fichiers `.wasm` et `.wasmN`. Le SDK réassemble les morceaux du runtime dans un flux marqué `application/wasm`.

## Isolation, Workers et WebAssembly

`src/demo/_headers` est copié vers `dist/_headers` et applique à la page :

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: cross-origin`

Le SDK crée son Worker comme module (`new Worker(..., { type: 'module' })`). L’isolation autorise `SharedArrayBuffer`, requis par le runtime multithread. Le chargeur assemble les morceaux WASM puis passe un flux `application/wasm` à WebAssembly. Si le runtime est sur une autre origine, elle doit être en HTTPS, autoriser les requêtes navigateur par CORS et rendre les ressources compatibles avec COEP (par exemple `Cross-Origin-Resource-Policy: cross-origin`).

## Fichiers supérieurs à 25 MiB

L’audit du checkout et de tout l’historique Git actuel ne trouve aucun fichier supérieur à 25 MiB. Le build `make build-sdk` n’émet aucun binaire de runtime.

Les documents du projet consignent une précédente mesure de `everest.zip` à 71 996 442 octets (environ 68,7 MiB) et des morceaux WebAssembly d’au plus 20 MiB. Ces artefacts ne sont pas dans ce Codespace et ces mesures ne sont donc pas vérifiées sur le build actuel. Si les artefacts sont reconstruits, il faudra les remesurer et vérifier leur contenu avant toute mise en ligne.

Si un fichier de plus de 25 MiB est clairement redistribuable, il peut être hébergé séparément en HTTPS (par exemple dans R2), avec les en-têtes CORS/CORP adaptés; `CELESTE_RUNTIME_BASE_URL` permet au client de localiser `runtime.json`, `_framework/` et `everest.zip`. R2 Standard prévoit actuellement un quota mensuel gratuit de 10 GB-mois, 1 million d’opérations de classe A et 10 millions d’opérations de classe B, sans frais de sortie réseau. Tout dépassement est facturable : ce n’est donc pas une garantie de coût nul. Voir les [tarifs R2 actuels](https://developers.cloudflare.com/r2/pricing/).

Cette stratégie n’autorise pas la redistribution. L’audit FMOD et l’absence de licence générale identifiée pour le bundle amont bloquent actuellement la publication de tout runtime qui les inclut, dans Pages, R2 ou GitHub Releases. Ne copie aucun binaire avant une autorisation claire et un audit des licences incluses dans l’artefact précis.

## Variables intégrées au frontend

Dans les variables de **build** du projet Pages, renseigne uniquement après validation :

- `SUPABASE_URL` : URL HTTPS du projet Supabase existant.
- `SUPABASE_PUBLISHABLE_KEY` : clé publiable `sb_publishable_`.
- `CELESTE_RUNTIME_BASE_URL` : URL HTTPS publique vers les ressources runtime approuvées, avec `/celeste/` si le bucket reproduit cette arborescence.

Le script de build exige les deux valeurs Supabase ensemble, refuse une clé qui n’est pas `sb_publishable_` et intègre ces valeurs dans les bundles navigateur. Elles sont donc publiques par conception. N’ajoute jamais `service_role`, `sb_secret_`, mot de passe ou jeton à Pages. Le build exécuté dans ce Codespace était sans configuration Supabase ni runtime; l’intégration du code est vérifiée, mais le vrai projet Supabase n’a pas été testé.

## Étapes de mise en ligne après levée des blocages

1. Conserve le dépôt privé pendant la revue de licence et jusqu’à ta décision de le rendre public.
2. Obtiens une confirmation écrite des auteurs du runtime amont et de Firelight Technologies, ou remplace le runtime par une version dont chaque composant est redistribuable dans ce contexte.
3. Vérifie chaque binaire final, crée sa liste de composants et joins les licences, attributions et crédits obligatoires. N’inclus aucun ZIP de Celeste.
4. Si un artefact légal dépasse 25 MiB, téléverse uniquement cet artefact vers un stockage HTTPS séparé; vérifie CORS, CORP et son coût prévisible.
5. Connecte le dépôt privé à un projet Cloudflare Pages, branche de production `main`, commande `npm ci && make build-sdk`, sortie `dist`.
6. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et, seulement si le runtime a été autorisé et hébergé, `CELESTE_RUNTIME_BASE_URL` dans les variables de build.
7. Ouvre un déploiement Preview HTTPS. Vérifie `crossOriginIsolated === true`, l’import local, le tutoriel, OPFS, le chargement du runtime, OAuth et les sauvegardes cloud. Ajoute ensuite l’URL Pages exacte aux Redirect URLs Supabase.
8. Après cette revue, décide séparément si tu rends le dépôt GitHub public et si tu actives la branche `main` pour la production Pages.

Le dépôt contient un workflow GitHub Actions de build et test, mais aucun workflow de déploiement. Aucun push, changement de visibilité ni déploiement n’a été déclenché ici.
