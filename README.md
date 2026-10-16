# Celeste Web — projet de portfolio

Prototype indépendant qui explore l’exécution de Celeste dans le navigateur avec WebAssembly et Everest. Le joueur importe lui-même l’archive ZIP d’une copie du jeu qu’il possède. **Le jeu commercial n’est pas fourni et aucun fichier du jeu n’est téléchargé depuis ce site.** Ce projet n’est ni affilié à Maddy Makes Games ni approuvé par elle.

Ce projet m’a permis de travailler sur TypeScript, WebAssembly multithread, Web Workers, le stockage privé OPFS, le traitement en flux d’archives ZIP et une synchronisation de sauvegardes avec Supabase. L’interface et les sauvegardes locales sont conservées; la synchronisation cloud est facultative et utilise uniquement la connexion GitHub.

## État du prototype

Le dépôt source et l’interface se compilent. Le build `make build-sdk` ne contient pas le runtime WebAssembly ni le build d’Everest. Le runtime de jeu disponible en amont inclut FMOD, dont les conditions et l’autorisation de redistribution dans un portfolio public ne sont pas encore établies. **Ne publie pas de runtime ni d’archive Everest avant la levée des blocages consignés dans [l’audit de publication](docs/publication-audit.md).** Sans runtime approuvé à `CELESTE_RUNTIME_BASE_URL`, la page sert l’interface, mais ne peut pas démarrer le jeu.

## Lancer l’aperçu dans Codespaces

Prérequis : Node.js 20 ou plus récent et Python 3.

```sh
npm ci
make preview PORT=8031
```

Ouvre `http://localhost:8031`. Dans Codespaces, ouvre l’onglet **Ports**, repère le port `8031`, puis sélectionne **Open in Browser**. Garde le port privé : Codespaces fournit une URL HTTPS pour l’aperçu.

La prévisualisation compile le SDK et la page avant de servir `dist/`. Elle ajoute les en-têtes COOP/COEP; le SDK assemble le flux WebAssembly avec le type MIME `application/wasm`.

Pour produire uniquement les fichiers statiques attendus par Pages :

```sh
npm ci
make build-sdk
```

Le build complet `make build` construit aussi le runtime et Everest et récupère des composants tiers. Il n’est pas nécessaire pour vérifier l’interface; ses artefacts ne doivent pas être redistribués tant que les droits ne sont pas confirmés.

## Importer sa copie de Celeste

1. Clique sur **Comment obtenir mon ZIP ?** pour afficher le tutoriel intégré.
2. Depuis Steam, GOG ou itch.io, ouvre le dossier d’une installation que tu as le droit d’utiliser.
3. Crée un ZIP du dossier complet. Il doit contenir `Celeste.exe` ou `Celeste.dll` et `Content/`.
4. Choisis ce ZIP dans la page, puis clique sur **Jouer**.

Au chargement de la page, le site vérifie d’abord si une installation valide est déjà présente dans OPFS. Si ce n’est pas le cas, le joueur doit sélectionner son ZIP. Le navigateur lit l’archive et écrit les fichiers dans OPFS; il ne l’envoie pas au serveur. Les lancements suivants réutilisent l’installation locale. Effacer les données du site supprime cette copie locale.

Après un clic explicite sur **Jouer**, le navigateur doit aussi charger le runtime WebAssembly et Everest depuis l’URL publique configurée (ou depuis le même site). Ces composants sont distincts des fichiers commerciaux de Celeste et leur redistribution est bloquée par l’audit ci-dessus. Le ZIP de Celeste reste fourni par le joueur et n’est pas téléchargé par l’application.

## Sauvegardes et Supabase

On peut jouer sans compte. Les fichiers de jeu et les sauvegardes restent dans le stockage privé du navigateur. L’export local et la synchronisation cloud facultative portent sur les archives de sauvegarde produites par `exportSaves()`; les fichiers de jeu ne sont pas transmis à Supabase.

La configuration de compilation accepte `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`, qui sont des valeurs publiques intégrées au navigateur. Elle refuse une clé autre qu’une clé `sb_publishable_`. **N’intègre jamais de `service_role`, de clé `sb_secret_`, de mot de passe ni de jeton au frontend.**

Pour un aperçu sans compte cloud, aucune variable Supabase n’est nécessaire. Pour activer les sauvegardes :

1. Copie `.env.example` en `.env.local` et indique l’URL et la clé publishable du projet existant.
2. Active GitHub comme fournisseur OAuth, désactive Email/Password dans Supabase Auth, configure les URL de redirection et applique le SQL du bucket selon [le guide Supabase](docs/supabase-cloud-saves.md).
3. Reconstruis le site. `.env.local` est ignoré par Git.

Si `username-login` a déjà été déployée sur ton projet, applique `supabase/disable-username-auth.sql` et déploie une fois la réponse 410 conservée dans `supabase/functions/username-login/`. Les profils existants sont conservés. Les étapes sont détaillées dans le guide Supabase.

Le build local exécuté pour cette révision n’avait aucune variable Supabase configurée. Le code compile les deux variables publiques ensemble, mais la connexion au vrai projet et la synchronisation réelle entre navigateurs restent à valider.

## Cloudflare Pages

- Commande de build : `npm ci && make build-sdk`
- Répertoire de sortie : `dist/` (`pages_build_output_dir` dans `wrangler.toml`)
- Les en-têtes COOP/COEP se trouvent dans `src/demo/_headers` et sont copiés dans `dist/_headers`.
- Le SDK crée le Web Worker comme module et fournit `application/wasm` au runtime après avoir réassemblé ses morceaux.
- Pages limite chaque asset à 25 MiB. Aucun fichier de ce dépôt ni de son historique ne dépasse cette limite; les binaires de runtime ne sont pas inclus dans ce build.

Pour les étapes de configuration, les limites de taille et la stratégie de stockage externe, voir [le guide Cloudflare Pages](docs/cloudflare-pages.md). N’ajoute aucune variable de runtime avant d’avoir confirmé les licences.

## Vérifications

```sh
make typecheck
make test
node scripts/audit-public-tree.mjs
make build-sdk
```

Les tests utilisent des OPFS, archives et clients Supabase synthétiques. Deux tests qui nécessitent un vrai ZIP d’installation Celeste sont ignorés; aucun test automatisé ne remplace un essai sur le projet Supabase ou dans un navigateur HTTPS.

## Crédits et licences

Le code original de ce dépôt est sous licence MIT, sous réserve des notices de tiers. Everest est sous licence MIT. Le runtime agrège notamment .NET, FNA, MonoMod et FMOD; les conditions varient d’un composant à l’autre et la redistribution du bundle n’est pas autorisée par le seul fait que son code source soit public. Celeste est un jeu commercial de Maddy Makes Games Inc. et n’est pas inclus. Voir [NOTICE.md](NOTICE.md) et [l’audit de publication](docs/publication-audit.md).
