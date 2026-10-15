# Notices et attributions

## Celeste n’est pas inclus

Celeste est un jeu commercial de Maddy Makes Games Inc. Aucun exécutable, contenu, asset, sauvegarde ou archive du jeu n’est fourni dans ce dépôt. Le joueur sélectionne sa propre archive ZIP ; le navigateur vérifie et installe les fichiers localement dans OPFS. Le code de cette application n’envoie pas les fichiers du jeu à Supabase ou à un endpoint d’installation.

Maddy Makes Games n’est ni affilié à ce projet ni son promoteur.

## Code de ce dépôt

Sauf indication contraire, `src/`, `scripts/`, `tests/`, les configurations et le Makefile sont proposés sous licence MIT. Voir [LICENSE](LICENSE).

## Everest

[Everest](https://github.com/EverestAPI/Everest), chargeur de mods et API de base de Celeste, est sous licence MIT, © Everest Team. Le dépôt ne le vend pas en source ; les scripts le construisent depuis une révision amont épinglée. Toute distribution de son build doit conserver sa licence et ses attributions.

## Runtime WebAssembly

Le runtime de [MercuryWorkshop/celeste-wasm](https://github.com/MercuryWorkshop/celeste-wasm) n’est pas inclus dans ce dépôt source. Le projet amont ne fournit pas de licence générale identifiable pour son bundle compilé ; demander l’autorisation de ses auteurs avant de le redistribuer.

Le runtime agrège notamment .NET (MIT), FNA (Ms-PL), FNA3D/FAudio/MojoShader/SDL3 (zlib), MonoMod/Mono.Cecil (MIT), NLua/KeraLua/Lua et FMOD Studio (licence propriétaire Firelight Technologies). Chaque composant a ses conditions propres. La licence FMOD distingue en particulier un moteur distribué intégré dans un produit de sa distribution en tant que moteur ou outil. La présence de binaires dans un build amont public ne constitue pas, à elle seule, une autorisation de les republier. Vérifie les conditions en vigueur et obtiens les autorisations applicables avant tout hébergement du runtime. Les références officielles figurent dans [l’audit de publication](docs/publication-audit.md).

## Résumé

- Code original du SDK et de l’interface : MIT.
- Everest : MIT, conserver la notice.
- Runtime WebAssembly : distribution conditionnée aux licences de ses composants et à l’autorisation des auteurs.
- Jeu Celeste et ses fichiers : non inclus et non distribués.
