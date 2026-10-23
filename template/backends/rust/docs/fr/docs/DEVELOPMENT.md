# Développement

Utiliser Node 24, pnpm 12, Rust 1.90 avec rustfmt/Clippy, une chaîne C, OpenSSL de
développement et Docker. Copier soi-même `.env.example` vers `.env` et remplacer
le secret avant `pnpm setup`. Setup démarre PostgreSQL/Mailpit et applique les
migrations locales avec `APP_ENV=development` et `DATABASE_FIXTURE_MODE=enabled`.
Aucun utilisateur n'est créé. Utiliser une base neuve distincte de celle d'un projet Nest.

`pnpm dev` génère les traductions avant de démarrer Vite et leur surveillance.
Vite ne démarre pas si la génération échoue. Les modifications suivantes des
catalogues sont régénérées automatiquement. pnpm reste le point d’entrée commun
des commandes de développement frontend et Rust.

Arrêter les processus de développement avant `pnpm clean:rust` pour supprimer
les compilations Rust dans `apps/api/target`. La prochaine compilation les
reconstruit ; les sources, téléchargements Cargo et volumes de base de données
sont conservés. `pnpm store prune` supprime séparément les paquets inutilisés
du cache partagé de pnpm.

```sh
pnpm check
pnpm test:integration
sh scripts/rust/runtime-check.sh
pnpm --filter web exec playwright install chromium
pnpm test:e2e
pnpm api:generate
pnpm docker:build
sh scripts/rust/image-check.sh
```

`pnpm check` vérifie format, Clippy, types, tests unitaires/auth, dérive OpenAPI,
documentation, frontières et compilation. Les tests d'intégration possèdent leurs
conteneurs SQLite/PostgreSQL/Mailpit ; le smoke test couvre le démarrage normal,
les migrations répétées, la disponibilité et le redémarrage. Chromium et le SDK
utilisent le vrai frontend, les migrations versionnées et la configuration Rust.
Les preuves restent dans `output/`. Aucun test ne lit un vrai fichier d'environnement
ou utilise des identifiants SMTP/HIBP de production. HIBP reste hors ligne en dev/test,
avec un serveur loopback pour tester son adaptateur HTTP.

Le [workflow Security](../.github/workflows/security.yml) audite les dépendances
JavaScript et analyse avec Trivy les images littérales d’infrastructure de Compose.
`API_IMAGE` est fournie au déploiement : son pipeline de publication doit analyser
cette image applicative revue avant déploiement. Ce workflow ne résout ni ne
télécharge cette référence. Installer l’[application GitHub Renovate](https://github.com/apps/renovate)
pour activer la configuration de mise à jour des dépendances incluse.

Le template fournit une seule migration initiale, `202610190001_initial.sql`, pour
l’identité et les quotas partagés. Son checksum remplace celui du prototype :
utiliser une base locale jetable neuve si cet ancien historique avait été appliqué.
Aucun reset ni adoption automatique de l’historique n’est exécuté.

Dans une application dont les données sont conservées, ajouter un nouveau fichier SQL horodaté dans `apps/api/migrations/`, et modifier
les entités SeaORM ensemble. Ne jamais modifier une migration appliquée. `build.rs`
suit les changements ; SQLx conserve versions/checksums, verrouille les exécutions
concurrentes et applique chaque migration PostgreSQL dans une transaction.
Aucune commande de reset ni migration inverse automatique n'est fournie.
`pnpm db:migrate` exige une fixture locale explicitement configurée. Un job déployé
utilise la même image revue que l'API :

```sh
webapp-api --migrate --target db.example.test:5432/application
webapp-api --check-migrations
```

En staging/production, la cible doit correspondre exactement au hostname, port et
nom de base configurés. Une migration distante exige autorisation opérateur,
sauvegarde et vérification de la cible. L'URL n'est jamais journalisée.
Le serveur refuse un historique absent, incomplet, inconnu ou altéré sans le modifier.
Il n'adopte pas un schéma Nest/Drizzle existant ni ses anciens hachages.

Le `.env.example` local utilise volontairement localhost. `pnpm dev` et
`pnpm setup` chargent explicitement le `.env` à la racine. Les valeurs des fixtures
ne servent pas au démarrage normal du serveur.

Pour le déploiement, copier [.env.production.example](../.env.production.example)
vers un `.env.production` privé puis remplacer les placeholders, ou injecter les
mêmes variables via la plateforme. Docker Compose charge le fichier choisi et
transmet les valeurs au processus Rust :

```sh
docker compose --env-file .env.production -f infra/compose/production.yml config --quiet
docker compose --env-file .env.production -f infra/compose/production.yml up -d
```

Exécuter les migrations explicites avant le démarrage, comme décrit plus haut.
Le fichier n’est jamais copié dans l’image. `WEB_URL` et `BETTER_AUTH_URL` sont
les origines publiques ; le port hôte loopback est distinct et destiné au reverse
proxy. Ne pas committer les vrais fichiers d’environnement ni les identifiants.

La production reçoit la configuration dans l'environnement du processus : `APP_ENV`,
`DATABASE_URL` avec un unique `sslmode=verify-full`, `BETTER_AUTH_SECRET` aléatoire
persistant, origines HTTPS sans chemin/query/identifiants `BETTER_AUTH_URL` et `WEB_URL`,
`EMAIL_MODE=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASSWORD`. En staging, `EMAIL_ALLOWED_RECIPIENTS` contient les adresses exactes
autorisées. `SMTP_SECURE=true` utilise TLS implicite ; `false` impose STARTTLS.
HIBP ne peut pas être désactivé dans ces environnements. `API_HOST` vaut loopback
par défaut et `API_PORT` 3001. Le runtime ne lit aucun fichier `.env` ; seules les
commandes pnpm de développement le chargent explicitement. Définir `VITE_API_URL`
à la compilation du frontend ; les cookies exigent un déploiement HTTPS same-site
compatible et des requêtes avec credentials.

`pnpm docker:build` produit une image Rust seule, non-root et sans fixtures.
Publier uniquement après revue. Le [Compose de production](../infra/compose/production.yml)
utilise cette image en lecture seule avec PostgreSQL/SMTP externes, ingress loopback,
sondes et arrêt gracieux. Exécuter les migrations avant le serveur. La plateforme
gère secrets, TLS, certificats, sauvegardes et sondes externes. Les modes capture/mémoire
sont refusés en production. Voir l'[exploitation](OBSERVABILITY.md).

`pnpm api:generate` exporte OpenAPI Rust et actualise `apps/web/src/lib/api/schema.d.ts`
et `responses.zod.ts` avec openapi-typescript et Orval. Versionner ces fichiers
générés avec les changements de DTO ; `pnpm api:check` les régénère temporairement
et refuse les dérives. Ne pas modifier les validateurs générés à la main. Les queries
valident les réponses via `apps/web/src/lib/api/contracts.ts` avant leur mise en cache ;
les schémas de formulaire restent locaux. Le projet Rust omet les schémas HTTP partagés
propres à Nest.

`pnpm api:generate` synchronise aussi les emails embarqués et les limites Rust
depuis `packages/i18n` et `packages/contracts` ; `pnpm api:check` détecte la dérive.

PostgreSQL Rust possède son projet/volume Compose, son identité de base et son
port loopback 5434, distincts de Nest. Un schéma non vide sans historique reconnu
est refusé avant tout DDL. Les paramètres URL autorisés sont uniquement `sslmode`,
`sslrootcert`, `sslcert`, `sslkey`, `application_name` et `options` ; les remplacements
de cible et les alias TLS sont refusés.

Les fixtures Docker compilent dans `apps/api/target/fixture`, séparé des autres
projets et du build natif. Seuls les téléchargements Cargo peuvent partager le
cache temporaire ; PostgreSQL/Mailpit restent propres à chaque exécution.

PostgreSQL utilise une [recette locale corrigée](../infra/images/postgres/README.md),
construite et scannée avant les validations CI. L’image Rust de production utilise
Distroless Debian 13 épinglée, avec glibc, OpenSSL et certificats CA. Sans shell ni
gestionnaire de paquets, `webapp-api` assure migrations et contrôles de santé. Le
test de l’image utilise une base PostgreSQL neuve possédée par le test et vérifie
démarrage, migrations répétées et redémarrage du vrai binaire release.
