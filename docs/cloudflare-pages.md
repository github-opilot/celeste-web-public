# Préparer Cloudflare Pages

La configuration Pages est dans `wrangler.toml`; le dossier de sortie est `dist/`. La commande de build de l’application est `npm ci && make build-sdk`. Le fichier `src/demo/_headers`, copié dans `dist/_headers`, active COOP/COEP pour `SharedArrayBuffer`. `coi.js` reste le repli pour les hébergeurs compatibles qui ne peuvent pas envoyer ces en-têtes.

## Où servir les gros composants

Le build privé observé contient des blocs WebAssembly de 20 MiB au plus, mais son `dist/celeste/everest.zip` fait 71 996 442 octets (environ 68,7 MiB). Cloudflare Pages limite chaque asset à 25 MiB. L’archive Everest ne peut donc pas rester un asset Pages indivisible.

La configuration prévoit `CELESTE_RUNTIME_BASE_URL`, une URL publique HTTPS vers un répertoire statique contenant `runtime.json`, `_framework/` et `everest.zip`. Le SDK charge ces ressources depuis cette base si elle est définie. Pour un déploiement avec R2, créer un bucket séparé pour les seuls composants redistribuables, servir les objets via un domaine HTTPS contrôlé, puis configurer CORS pour l’origine Pages et les requêtes GET/HEAD. L’archive Everest et les fichiers runtime peuvent alors être stockés hors des assets Pages. **Ne téléverse aucun composant runtime tant que l’audit de licence n’est pas levé.**

Exemple de variables de build Cloudflare (pas de secret) :

- `SUPABASE_URL` : URL du projet existant.
- `SUPABASE_PUBLISHABLE_KEY` : clé publishable existante.
- `CELESTE_RUNTIME_BASE_URL` : URL HTTPS du répertoire de ressources, terminée par `/celeste/` si le bucket reflète la structure locale.

Les paramètres Supabase et l’URL runtime sont compilés en configuration navigateur : les deux premiers sont publics par conception, l’URL runtime est une adresse publique. N’ajoute jamais de `service_role`, `sb_secret_`, mot de passe ou token au build frontend. Les secrets de l’Edge Function `username-login` restent dans les secrets Supabase.

## Mise en service après l’audit

1. Crée un projet Pages connecté au dépôt GitHub, branche de production `main`, commande de build `npm ci && make build-sdk`, sortie `dist`.
2. Configure les trois variables publiques ci-dessus dans les paramètres de build, après validation des licences runtime.
3. Ajoute le domaine HTTPS définitif dans Supabase **Authentication → URL Configuration → Redirect URLs**, sans retirer les URL de Codespaces déjà utilisées.
4. Vérifie `crossOriginIsolated === true`, les réponses WASM depuis l’origine runtime, l’import ZIP local, l’authentification OAuth et les sauvegardes cloud.
5. Teste le workflow Pages sur un environnement Preview avant de choisir la branche de production.

Le dépôt ne contient pas de workflow de publication automatique et aucun déploiement n’est déclenché par ces fichiers.
