# Architecture

`apps/api/src/lib.rs` compose Axum, Better Auth RS, SMTP et PostgreSQL. `runtime.rs`
valide l'environnement avant connexion ; le démarrage vérifie seulement les migrations.
La commande `--migrate` applique les SQL embarqués dans `migrations/` ; `schema.rs`
possède les entités SeaORM. SQLite est réservé aux tests isolés.

`signup.rs` envoie automatiquement la vérification et refuse la connexion non
vérifiée avant création d'une session. `verification.rs` vérifie expiration stricte
et redirections autorisées. Les mots de passe exacts sont hachés avec Argon2 ; HIBP
vérifie les nouveaux mots de passe en staging/production. Une erreur de reset consomme
le lien sans modifier le mot de passe. `quotas.rs` effectue l'admission atomique en
PostgreSQL. L'adresse provient du socket ; les IP transmises par en-tête sont ignorées.
Les clients d'un reverse proxy partagent donc son quota.

Le frontend utilise les cookies Better Auth et les DTO OpenAPI. `packages/contracts`
possède la validation frontend indépendante, `packages/i18n` les traductions/chemins,
et `packages/ui` les primitives. L'entrée privée revérifie `/api/me` et les transitions
d'auth nettoient les caches privés. `/api/users` exige une session vérifiée,
un curseur ID unique et des recherches littérales, insensibles à la casse et bornées.
`pnpm api:generate` exporte Utoipa sans base/SMTP et génère les types frontend.
Les types du SDK Better Auth restent séparés de l'OpenAPI applicatif.
