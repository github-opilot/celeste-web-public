# Sauvegardes cloud Supabase

L’intégration cliente utilise uniquement l’URL du projet et une clé publishable. La clé est publique par conception ; les accès aux archives sont limités par Auth et les politiques RLS de Storage. Aucune clé `service_role` ne doit être ajoutée au navigateur ni à `.env.local`.

## Configuration locale

1. Copie `.env.example` vers `.env.local`.
2. Dans Supabase, relève le Project URL et une clé `sb_publishable_` depuis **Project Settings → API Keys**.
3. Renseigne uniquement :

   ```dotenv
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

4. Lance `make preview PORT=8033`. Le build produit `dist/supabase.js` avec ces deux valeurs publiques ; `.env.local` reste hors de Git et n’est pas servi par le serveur statique. Sans configuration, les sauvegardes locales restent disponibles et l’interface indique que le cloud n’est pas configuré.

## Tableau de bord Supabase

1. Dans **Authentication → Sign In / Providers**, active GitHub et renseigne le Client ID et le Client Secret d’une GitHub OAuth App. Désactive le fournisseur **Email** si tu veux que le projet n’accepte que GitHub.
2. Dans la GitHub OAuth App, utilise comme **Authorization callback URL** la valeur affichée par Supabase, au format `https://<project-ref>.supabase.co/auth/v1/callback`. Ce secret reste dans le tableau de bord Supabase.
3. Dans **Authentication → URL Configuration**, définis le Site URL sur l’URL finale du site. Ajoute ensuite aux Redirect URLs l’URL HTTPS exacte du port Codespaces utilisé (copiée dans la barre d’adresse, par exemple le port 8033) et l’URL du futur site public. Le client redirige vers l’origine et le chemin de la page courante.
4. Dans **SQL Editor**, exécute [`supabase/celeste-saves.sql`](../supabase/celeste-saves.sql). Cela crée le bucket privé `celeste-saves`, autorise uniquement la lecture et l’ajout dans le dossier de l’utilisateur connecté et ne donne aucun droit de mise à jour ou de suppression.

L’application accepte uniquement les sessions qui contiennent une identité GitHub. Elle déconnecte les sessions email ou mot de passe préexistantes; désactiver **Email** dans Supabase empêche également l’utilisation de cette méthode via le projet.

### Retirer une ancienne connexion par pseudo et mot de passe

Si tu avais déjà déployé cette fonctionnalité, exécute [`supabase/disable-username-auth.sql`](../supabase/disable-username-auth.sql) dans le SQL Editor. Le script supprime le déclencheur et les fonctions de limitation obsolètes, mais conserve `public.profiles` et ses données.

Déploie ensuite une fois la fonction désactivée afin que l’ancienne URL réponde `410 Gone` au lieu d’accepter les identifiants :

```sh
supabase link --project-ref <project-ref>
supabase functions deploy username-login
```

Tu peux ensuite supprimer la fonction `username-login` depuis le tableau de bord Supabase. La configuration de cette fonction et son code 410 restent dans le dépôt uniquement comme étape de retrait pour les projets qui l’avaient déjà déployée.

Les archives sont immuables et rangées sous `<UUID-utilisateur>/<horodatage>-<UUID>-<SHA-256-archive>-<SHA-256-contenu>.tar.gz`. Chaque nouvel envoi conserve les anciennes versions. Le client n’utilise jamais `upsert`, `UPDATE` ou `DELETE`.

## Restauration et fonctionnement hors ligne

Une restauration vérifie le SHA-256 contenu dans le nom d’objet et lit l’archive TAR gzip en entier avant de modifier OPFS. Si des fichiers locaux existent, une confirmation est demandée ; une copie locale de sécurité est alors conservée dans IndexedDB avant l’appel à `importSaves()`. `importSaves()` fusionne les chemins de l’archive sans effacer les autres fichiers locaux.

Si le réseau tombe, chaque archive stable est ajoutée à une file IndexedDB et envoyée au retour en ligne ou à la visite suivante. Les instantanés hors ligne ne se remplacent pas. Une entrée de file n’est retirée qu’après confirmation que son empreinte correspond à une version cloud. Une copie de sécurité avant restauration n’est jamais supprimée automatiquement.

La synchronisation automatique est tentée après l’événement normal de fin de Celeste, une fois deux exports successifs identiques. La page attend la capture locale ; l’envoi peut continuer/reprendre à la prochaine visite si le réseau échoue.

## Vérification réelle

Les tests du dépôt couvrent des archives synthétiques et des faux clients Storage/Auth ; ils ne valident pas la configuration d’un vrai projet Supabase. Après avoir appliqué les étapes du tableau de bord :

1. Ouvre le site dans le navigateur A et connecte-toi avec GitHub; lance Celeste puis quitte normalement.
2. Dans Préférences → Sauvegardes cloud, vérifie qu’une date de synchronisation et une version sont affichées.
3. Ouvre le même site dans un navigateur B (ou profil privé), connecte-toi avec le même compte et restaure la version. Vérifie la confirmation et la copie de sécurité avant de lancer le jeu.
4. Connecte un autre compte GitHub et vérifie qu’il ne voit pas les versions du premier. Dans Supabase Storage, le bucket doit rester privé. Les requêtes sous un autre UUID doivent être refusées par RLS.
5. Coupe le réseau, quitte le jeu, vérifie l’état « en attente », rétablis le réseau et vérifie que la file se synchronise sans effacer OPFS.

La synchronisation ne doit pas être considérée comme validée avant ces essais réels sur deux navigateurs et deux comptes.
