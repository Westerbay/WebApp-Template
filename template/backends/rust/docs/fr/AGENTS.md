# Instructions pour les agents

Lire `docs/CONTEXT.md`, puis les documents utiles. Inspecter Git et préserver les
modifications existantes. Chercher les contrats et leurs consommateurs avant d'ajouter du code partagé.
`apps/api` possède le runtime Rust, l'auth, les entités SeaORM et les migrations SQLx.
`apps/web` ne doit jamais importer le serveur. Les contraintes frontend et types de
pagination appartiennent à `packages/contracts`, les DTO HTTP et validateurs Zod
générés à OpenAPI Rust, et les primitives à `packages/ui`.
Ne jamais lire/modifier de vrais fichiers d'environnement ou secrets. Ne jamais
migrer, réinitialiser ou remplir une base distante, partagée ou non vérifiée.
Ne pas committer, pousser ou déployer sans autorisation explicite. Ajouter une
migration plutôt que modifier une version appliquée ; aucun DDL automatique au démarrage.
Vérifier le diff et les documents pertinents. Pour l'auth : `pnpm check`,
`pnpm test:integration`, `pnpm test:e2e`. Respecter `docs/DESIGN.md` pour l'interface.

Garder les modules métier indépendants. Les DTO communs appartiennent à `contracts/`.
Infrastructure et configuration n'importent ni les fonctionnalités ni leurs racines.
Assembler dans `app.rs`, `bootstrap.rs`, `cli/` et `openapi/` ; garder `main.rs` minimal.
La configuration valide les valeurs ; l'infrastructure possède connexions et transports.
