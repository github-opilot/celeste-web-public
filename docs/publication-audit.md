# Audit avant publication

État de cet audit : **publication de binaires/runtime non autorisée par les informations actuellement disponibles**. Aucun dépôt GitHub public, bucket R2 ou site n’a été créé ni publié depuis ce travail.

## Fichiers du jeu et confidentialité

- `.env.local`, `dist/`, les caches de build et les dépendances sont exclus de la copie.
- Le flux public propose un import ZIP local et n’importe plus aucun chargeur ou endpoint `CELESTE_PRIVATE_ARCHIVE`.
- Le serveur de prévisualisation ne sert que des fichiers statiques et les en-têtes COOP/COEP.
- Le code cloud passe à Supabase uniquement les archives retournées par `exportSaves()`; il ne passe pas le ZIP ni les fichiers du jeu.
- `.gitignore` exclut les archives, exécutables, DLL, binaires WASM, dossiers `Content`, sauvegardes et mods.
- L’historique du projet public doit commencer par un commit neuf; aucun ancien historique ni secret d’origine ne doit être importé.

## Droits et composants

Le dépôt source original possède une licence MIT et `NOTICE.md` reconnaît séparément les licences des dépendances. Cela ne couvre pas automatiquement chaque artefact de build.

La notice locale indique que le bundle du runtime provient de MercuryWorkshop/celeste-wasm et que ce dépôt amont ne fournit pas de licence générale identifiable pour son bundle. Le runtime embarque FMOD. La page officielle FMOD précise que la licence gratuite hobby/éducation/non commerciale autorise la redistribution de FMOD intégré à un produit logiciel et exclut la distribution comme moteur ou boîte à outils; les conditions requièrent aussi les crédits et logo FMOD. La licence de Celeste elle-même ne donne pas automatiquement au site tiers le droit de republier le runtime ou le jeu. Ces textes ne permettent pas de confirmer que le propriétaire de ce projet a les droits de republier le bundle reçu de l’amont.

Avant hébergement du runtime : obtenir une autorisation écrite des auteurs du bundle amont et confirmer auprès de Firelight Technologies que le produit et son mode d’hébergement sont couverts; satisfaire les obligations de marque/attribution ou obtenir une dérogation; fournir les notices de toutes les dépendances. Tant que ce point n’est pas établi, ne pas ajouter les binaires à Git, Pages, R2 ou Releases. Le code source et la configuration de l’application peuvent être examinés séparément.

Liens de première main consultés le 15 octobre 2026 : [FMOD Legal](https://www.fmod.com/legal), [FMOD Licensing](https://www.fmod.com/licensing), [FMOD Attribution](https://www.fmod.com/attribution), [amont MercuryWorkshop/celeste-wasm](https://github.com/MercuryWorkshop/celeste-wasm).

## Limite Cloudflare Pages

La documentation Cloudflare Pages indique une limite de 25 MiB par asset. Dans la compilation locale existante, `everest.zip` mesure 71 996 442 octets; il dépasse donc cette limite. Les fichiers WebAssembly sont déjà fractionnés en morceaux de 20 MiB maximum. La solution prévue est un stockage séparé HTTPS (par exemple R2) pour les composants qu’il est légal de redistribuer, avec `CELESTE_RUNTIME_BASE_URL`; ce dépôt ne téléverse ni ne configure le bucket. Voir [docs/cloudflare-pages.md](cloudflare-pages.md).

## Avant de rendre le dépôt public

- Exécuter `make test` et `node scripts/audit-public-tree.mjs`.
- Examiner les fichiers Git suivis (`git ls-files`) et l’historique (`git log --all --stat`); ne jamais importer l’historique du projet privé.
- Confirmer que `.env.local` n’est pas suivi et que le scan de secrets ne relève aucune valeur sensible.
- Confirmer les licences et notices de chaque binaire de production séparément du code MIT.
- Tester sur une URL HTTPS publique que les fichiers de jeu ne sont pas émis sur le réseau. Confirmer que seules les archives de sauvegarde sont envoyées à Supabase.
- Faire vérifier la configuration OAuth/RLS sans changer le projet Supabase existant.
- Présenter cet audit et le build final au propriétaire, puis obtenir sa validation avant de rendre le dépôt public ou de déployer Pages.
