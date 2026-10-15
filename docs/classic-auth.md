# Connexion par pseudo et mot de passe

Cette intégration garde Supabase Auth comme seul gestionnaire des mots de passe. `public.profiles` ne contient qu’un identifiant utilisateur et un pseudo. La connexion par pseudo échange les identifiants avec la fonction Edge `username-login`, qui retrouve l’identifiant Auth, vérifie le mot de passe par l’API Auth, puis renvoie la session du même utilisateur. Les sauvegardes cloud restent sous le même `auth.uid()`.

## Mise en service Supabase

1. Dans **Authentication → Providers**, garde GitHub activé et active Email. Configure le serveur SMTP avant d’utiliser les inscriptions et les e-mails de récupération en production.
2. Dans **Authentication → URL Configuration**, ajoute les URL de retour exactes du Codespace et du futur site à Redirect URLs. Le hostname Codespaces change parfois : ajoute l’URL complète actuelle, par exemple `https://<codespace>-8033.app.github.dev/`. Ajoute aussi l’URL du site public lorsqu’il existera. Les URLs de retour sont construites depuis `window.location.origin`.
3. Dans **SQL Editor**, applique [username-auth.sql](../supabase/username-auth.sql). Il crée `profiles`, son index pseudo unique sans casse, les politiques RLS personnelles et les compteurs de limitation. Il ne modifie pas le bucket ni les politiques des sauvegardes cloud.
4. Depuis un terminal Codespaces déjà authentifié à Supabase CLI, lie le projet et déploie la fonction :

   ```sh
   supabase link --project-ref <project-ref>
   supabase functions deploy username-login
   ```

5. Configure les secrets de la fonction avec les origines de navigateur exactes, séparées par des virgules :

   ```sh
   supabase secrets set \
     USERNAME_LOGIN_HMAC_SECRET="$(openssl rand -hex 32)" \
     USERNAME_LOGIN_ALLOWED_ORIGINS="https://<codespace>-8033.app.github.dev,https://<site-public>"
   ```

   Pour un test local, ajoute explicitement `http://127.0.0.1:8033` à la liste. En production, ajoute l’URL HTTPS exacte du domaine Pages choisi. La fonction reçoit les clés Supabase serveur depuis son environnement. Aucune clé `service_role` ou secrète ne doit être copiée dans `.env.local`, `src`, `dist` ou le navigateur.

La configuration du dépôt désactive la validation JWT du gateway uniquement pour cette fonction de connexion, car le joueur n’a pas encore de session. La fonction applique sa propre liste d’origines, borne le corps JSON, utilise Auth pour valider le mot de passe et appelle un compteur RPC accessible au seul rôle serveur. CORS réduit les appels depuis les pages non autorisées, mais ne remplace pas la limitation serveur : un client non navigateur peut fabriquer un en-tête `Origin`.

## Comptes GitHub déjà existants

Connecte-toi avec GitHub, puis ouvre le bouton du compte dans l’en-tête. Le formulaire modifie le pseudo dans la ligne `profiles` du même identifiant Supabase et ajoute un mot de passe avec `auth.updateUser`; il ne crée pas de nouvel utilisateur. Pour activer le mot de passe, le compte GitHub doit avoir une adresse e-mail confirmée dans Supabase. Si l’ajout du mot de passe réussit mais que le pseudo est déjà utilisé, choisis un autre pseudo et recommence : la session et l’identifiant du compte restent inchangés.

## Test local et validation réelle

`make test` exécute des tests synthétiques pour l’inscription concurrente (dont deux variantes de casse), les réponses génériques au mauvais pseudo/mot de passe, la limite de tentatives, le flux de mot de passe oublié, le rattachement GitHub au même identifiant et les contrats RLS du SQL.

Après le déploiement, teste réellement : inscris un compte avec une adresse que tu contrôles, confirme l’e-mail, déconnecte-toi, puis connecte-toi avec le pseudo et le mot de passe. Ouvre ensuite les préférences Cloud et vérifie que les versions existantes apparaissent sous ce compte. Connecte-toi avec GitHub pour un compte existant, ajoute-lui un pseudo/mot de passe, puis vérifie que son identifiant de compte et ses sauvegardes cloud sont conservés. Les tests locaux ne remplacent pas ces vérifications sur le projet Supabase réel.
