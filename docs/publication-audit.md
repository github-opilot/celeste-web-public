# Audit avant publication

État au 15 octobre 2026 : audit du code source et de l’historique local effectué. L’interface se compile et les tests passent. **La publication d’un site jouable reste bloquée par la redistribution du runtime.** Aucun changement de visibilité GitHub, push, bucket ou déploiement n’a été réalisé.

## Jeu et confidentialité

- Aucun exécutable, contenu, archive, sauvegarde ou asset de Celeste n’est suivi par Git ni présent dans ce checkout. L’historique local ne contient qu’un commit initial et aucun blob volumineux.
- `.gitignore` exclut les archives, exécutables, DLL, WASM, banques audio, sauvegardes, mods et `.env.local`.
- L’application vérifie OPFS à l’ouverture. En l’absence d’installation valide, le joueur doit choisir son ZIP. Le ZIP est lu localement et les fichiers sont écrits dans OPFS; aucun envoi de ces données au réseau n’est implémenté.
- Le chargement du runtime et d’Everest est distinct : il se déclenche après le lancement explicite et utilise `CELESTE_RUNTIME_BASE_URL` ou l’origine du SDK. Le runtime peut contenir FMOD et son téléchargement automatique depuis un hôte public est également soumis aux licences.
- Le code cloud appelle `exportSaves()` puis transmet l’archive de sauvegarde à Supabase. Les tests vérifient ce chemin et les contrôles RLS; ils ne remplacent pas un essai réel.

## Résultat des scans locaux

- `node scripts/audit-public-tree.mjs` : aucun fichier commercial, secret détectable ou fichier supérieur à 25 MiB.
- Scan des noms suivis : aucun `.env.local`, archive, exécutable, DLL, WASM, banque FMOD ou contenu du jeu.
- Scan de tout l’historique local : un commit, aucun objet de plus de 25 MiB et aucune valeur correspondant aux formats usuels de clés privées, tokens GitHub, `sb_secret_` ou clé AWS.
- Le seul fichier `.env*` suivi est `.env.example`, sans valeur Supabase. Aucun vrai identifiant ou secret Supabase n’était dans l’environnement de build.
- Les mots `service_role`, `sb_secret_` et formats de tokens apparaissent parfois comme exemples, contrôles ou noms de variables dans le code et la documentation; aucun secret correspondant n’a été détecté.

Ces vérifications couvrent le dépôt et l’historique disponible dans ce Codespace, pas les autres clones, sauvegardes, caches ni l’état de visibilité distant de GitHub.

## Runtime et licences

Le code original du dépôt est sous licence MIT et Everest sous MIT, avec conservation des notices applicables. Cela n’autorise pas le runtime agrégé. L’inventaire dans `NOTICE.md` cite notamment .NET (MIT), FNA (Ms-PL), FNA3D/FAudio/MojoShader/SDL3 (zlib), MonoMod/Mono.Cecil (MIT) et FMOD Studio (licence propriétaire Firelight Technologies). Il faut confirmer les versions et notices réelles du bundle précis avant sa redistribution.

La [licence officielle FMOD](https://www.fmod.com/legal) réserve l’usage hobby/éducation/non commercial à FMOD Engine intégré et redistribué dans une application logicielle; elle exclut sa distribution comme moteur ou boîte à outils. Cette voie non commerciale exclut aussi monétisation, parrainage ou promotion. La licence exige un crédit produit comportant FMOD et Firelight Technologies Pty Ltd. La [page officielle d’attribution](https://www.fmod.com/attribution) demande la mention « FMOD Studio » et le logo FMOD à l’écran au démarrage avant toute interaction.

Ce port web est destiné à être présenté dans un portfolio scolaire et le composant FMOD est inclus dans un runtime moteur téléchargé séparément. Les pages officielles ne suffisent pas à établir que cette combinaison entre dans l’exception éducative/non commerciale; aucun logo FMOD n’est fourni ici, et le bundle `MercuryWorkshop/celeste-wasm` n’expose pas de licence générale de redistribution identifiable. **Aucun runtime comprenant FMOD ne doit être publié sur Pages, R2, GitHub Releases ou un autre CDN avant confirmation écrite de Firelight Technologies et des auteurs du bundle amont, plus la mise en conformité avec leurs exigences.** Une autre voie est de reconstruire le runtime sans composant non autorisé, si cela est techniquement possible.

FMOD et tout autre composant propriétaire ou non inventorié sont des blocages. Les composants MIT, Ms-PL, zlib ou Apache peuvent être redistribuables selon leurs licences, mais le bundle compilé doit être examiné fichier par fichier et accompagné des avis requis. Un binaire public amont n’accorde pas à ce projet le droit de le republier.

## Limite Cloudflare et stratégie de stockage

L’audit du checkout courant trouve zéro fichier supérieur à 25 MiB dans la copie de travail et dans l’historique Git. Le build `make build-sdk` n’inclut aucun binaire runtime.

Une ancienne mesure consignée dans ce dépôt donne `everest.zip` à 71 996 442 octets; le fichier n’existe pas dans le Codespace actuel et cette valeur n’a pas été reproduite. Les documents consignent aussi des morceaux WASM de 20 MiB maximum, non présents dans ce checkout. Si un build autorisé est produit, refaire l’inventaire de taille et de licence de tous ses fichiers. Les artefacts licites de plus de 25 MiB peuvent être servis séparément en HTTPS, par exemple via R2, avec CORS/CORP adaptés. Les plafonds gratuits et prix R2 changent; une utilisation au-delà des quotas gratuits est facturable.

La limite Pages de 25 MiB par fichier et la configuration de déploiement sont décrites dans [cloudflare-pages.md](cloudflare-pages.md).

## Décision

Le dépôt source passe les scans locaux et le build de l’interface. Le site de portfolio peut décrire et montrer l’interface compilée, mais **le projet ne doit pas être présenté comme un jeu déployé ou publié comme site jouable tant que les licences et l’hébergement du runtime ne sont pas réglés**. Aucun fichier runtime ne doit être ajouté à Git avant ce contrôle. Voir aussi les [crédits et avis tiers](../NOTICE.md).
