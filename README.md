# Celeste Web Public

Application de démonstration qui lance Celeste (2018) dans le navigateur avec le moteur WebAssembly et Everest. **Le jeu n’est pas fourni** : chaque joueur doit importer un ZIP issu de sa propre installation.

Le projet conserve le SDK WebAssembly, l’interface Celeste personnalisée, l’import local dans OPFS, les sauvegardes locales, l’authentification Supabase existante et la synchronisation cloud facultative. Aucun endpoint de téléchargement du jeu n’est inclus.

## Prérequis

- Node.js 20 ou plus récent et npm.
- Python 3 pour le serveur de prévisualisation.
- Une copie de Celeste que tu as le droit d’utiliser.
- Pour une compilation complète locale du runtime : Docker (voir le Makefile).

## Installer et lancer l’interface

```sh
npm ci
cp .env.example .env.local
# Renseigner les paramètres publics Supabase si la synchronisation cloud est activée
make preview PORT=8033
```

Ouvre ensuite `http://localhost:8033` (ou l’URL HTTPS du port Codespaces). La prévisualisation construit le SDK et sert `dist/` avec les en-têtes COOP/COEP nécessaires aux threads WebAssembly.

Pour compiler uniquement les sources TypeScript et la page :

```sh
make build-sdk
```

Pour construire localement le runtime et Everest en plus du SDK, utilise `make build`. Cette étape récupère et compile des composants tiers. **Ne publie pas son dossier `dist/celeste/` avant d’avoir confirmé les droits de redistribution décrits dans [l’audit de publication](docs/publication-audit.md).**

## Importer Celeste

1. Clique sur **Comment obtenir mon ZIP ?** pour ouvrir le tutoriel intégré.
2. Depuis Steam, GOG ou itch.io, ouvre le dossier de l’installation que tu possèdes.
3. Crée un ZIP du dossier complet. L’archive doit contenir `Celeste.exe` ou `Celeste.dll` et `Content/` (dialogues, cartes, graphismes et banque audio).
4. Sélectionne ce ZIP dans la page, vérifie qu’il est valide, puis clique sur **Jouer**.

Le premier import et le premier démarrage sont longs : le navigateur écrit les fichiers dans OPFS puis initialise WebAssembly et applique les patchs du chargeur. Les visites suivantes réutilisent l’installation locale. Si les données du site sont supprimées ou si l’installation est invalide, importe de nouveau ton ZIP. Le site ne téléverse pas l’archive ni les fichiers du jeu.

L’installation et les sauvegardes locales sont liées à l’origine et au profil du navigateur. Les préférences permettent d’exporter/restaurer les sauvegardes, et l’espace cloud permet de les synchroniser après connexion. Il est possible de jouer sans compte.

## Sauvegardes Supabase facultatives

Le client utilise uniquement `SUPABASE_URL` et une clé publishable `SUPABASE_PUBLISHABLE_KEY`. Ces valeurs sont injectées dans le bundle de navigateur ; **n’y mets jamais une clé `service_role` ou `sb_secret_`**. Copie `.env.example` en `.env.local`; ce dernier est ignoré par Git.

Pour conserver l’authentification par GitHub et pseudo/mot de passe :

1. Applique les fichiers SQL existants dans `supabase/` au même projet Supabase.
2. Déploie la fonction `username-login` et configure ses secrets exclusivement dans Supabase.
3. Active GitHub OAuth dans Supabase et ajoute les URL HTTPS exactes du Codespace et du site public dans **Authentication → URL Configuration → Redirect URLs**.
4. Applique les politiques RLS du bucket `celeste-saves` déjà décrites dans [docs/supabase-cloud-saves.md](docs/supabase-cloud-saves.md).

La synchronisation n’est validée qu’après un essai avec le vrai projet Supabase et deux navigateurs. Elle ne concerne que les archives produites par `exportSaves()`; les fichiers du jeu ne passent jamais par Storage.

## Tests

```sh
make test
```

Les tests automatisés utilisent des OPFS, archives et clients Supabase synthétiques. Ils ne lancent pas le jeu commercial et ne remplacent pas un test réel d’OAuth ou de synchronisation entre deux navigateurs.

## Déploiement Cloudflare Pages

La configuration de base est dans `wrangler.toml`; la sortie attendue est `dist/` et `src/demo/_headers` configure l’isolation cross-origin. Un build public complet doit fournir au runtime et à Everest une origine de distribution conforme aux licences et à la politique COEP. Pages limite chaque fichier du site à 25 MiB. Le `everest.zip` actuellement produit localement fait environ 68,7 MiB : il ne peut pas être déployé tel quel comme asset Pages. Les blocs WASM sont séparés en morceaux de 20 MiB, qui respectent la limite individuelle.

Le runtime contient FMOD et ne doit pas être téléversé vers Pages, R2 ou GitHub Releases tant que les droits de redistribution et les mentions obligatoires n’ont pas été confirmés. Voir [docs/cloudflare-pages.md](docs/cloudflare-pages.md) et [docs/publication-audit.md](docs/publication-audit.md). Cette copie n’active aucun déploiement automatique.

## Crédits et licences

Le code de ce dépôt est sous MIT, sous réserve des notices de tiers. Everest est MIT et sa notice doit accompagner sa distribution. Le runtime WebAssembly agrège plusieurs composants, notamment FNA sous Ms-PL et FMOD sous licence propriétaire. Celeste est un jeu commercial de Maddy Makes Games Inc. et n’est pas affilié à ce projet. Les détails se trouvent dans [NOTICE.md](NOTICE.md).
