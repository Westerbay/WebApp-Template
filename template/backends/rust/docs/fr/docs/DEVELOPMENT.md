# Développement

Utiliser Node 24.22.1, pnpm 12.11.2, Rust 1.90 avec rustfmt/Clippy, une chaîne C, OpenSSL de
développement et Docker. Copier soi-même `.env.example` vers `.env` et remplacer
le secret avant `pnpm run setup`. Setup démarre PostgreSQL/Mailpit et applique les
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
```

`pnpm check` vérifie format, Clippy, types, tests unitaires/auth, dérive OpenAPI,
documentation, frontières et compilation. Les tests d'intégration possèdent leurs
conteneurs SQLite/PostgreSQL/Mailpit ; le smoke test couvre le démarrage normal,
les migrations répétées, la disponibilité et le redémarrage. Chromium et le SDK
utilisent le vrai frontend, les migrations versionnées et la configuration Rust.
Les preuves restent dans `output/`. Aucun test ne lit un vrai fichier d'environnement
ou utilise des identifiants SMTP/HIBP de production. HIBP reste hors ligne en dev/test,
avec un serveur loopback pour tester son adaptateur HTTP.

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
`pnpm run setup` chargent explicitement le `.env` à la racine. Les valeurs des fixtures
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

## Réparer le gestionnaire de paquets

Le projet impose pnpm 12.11.2. En 12.4.1, l'installation propre à pnpm pouvait
écraser son exécutable natif en écrivant un alias partageant le même fichier par
un lien physique. Chaque commande pouvait ensuite invoquer `pnpm dlx` en boucle,
sans atteindre les scripts du projet. Restaurer seulement le binaire en gardant
la version concernée ne supprimait pas le risque de récidive.
[L'implémentation 12.11.2](https://github.com/pnpm/pnpm/blob/v12.11.2/pnpm/crates/cli/src/cli_args/setup.rs)
remplace les alias de manière atomique.

Si pnpm bloque avant toute sortie du projet, l'arrêter avec Ctrl+C. Depuis un
checkout actualisé utilisant Node 24.22.1, exécuter les commandes suivantes pour
réparer la sélection de Corepack et l'installation autonome. Avec nvm,
sélectionner d'abord Node avec `nvm use 24.22.1`. npm et Corepack doivent être
accessibles dans `PATH`.

```bash
node --version # v24.22.1
corepack install --global pnpm@12.11.2
corepack pnpm --version # 12.11.2
npx --yes --package=pnpm@12.11.2 pnpm self-update 12.11.2
corepack enable pnpm
hash -r # bash/zsh
pnpm --version # 12.11.2
pnpm run docs:check
```

L'étape `npx` lance un pnpm neuf sans passer par le lanceur défectueux. Ne pas
utiliser `corepack pnpm self-update` : pnpm refuse cette opération sous Corepack.
Sur macOS/Linux, `type -a pnpm` liste les installations concurrentes si la dernière
vérification échoue encore. Ne pas supprimer les caches Cargo ou volumes de base
pour réparer pnpm.

Utiliser `pnpm run setup` pour l'infrastructure et les migrations de l'application ;
`pnpm pm setup` configure le gestionnaire de paquets lui-même. Garder alignés la
version du projet, le minimum moteur, le lockfile, le contrôleur et les versions CI.

## Conformité HTML

Installer Java 17+ et Chromium, puis lancer le même contrôle HTML que la CI :

```bash
pnpm --filter web exec playwright install chromium
pnpm test:html
```

Le Nu Html Checker épinglé valide les réponses SSR brutes et les documents
Chromium hydratés ci-dessous pour chaque langue configurée. Le HTML des e-mails
vient du vrai moteur de rendu avec des destinataires et liens fictifs. Aucune
base, aucun serveur SMTP ni vrai fichier d’environnement n’est utilisé. Les
requêtes API navigateur inconnues sont bloquées ; le tableau utilise des
réponses synthétiques.

| Routes                   | États                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Connexion et inscription | Formulaires SSR et hydratés                                                                                    |
| Demande de vérification  | Formulaire SSR et hydraté                                                                                      |
| Résultat de vérification | Résultat SSR et hydraté, succès ou lien invalide                                                               |
| Demande de mot de passe  | Formulaire SSR et hydraté ; erreur de validation et confirmation après navigation cliente                      |
| Nouveau mot de passe     | Formulaire SSR et hydraté ou erreur sans jeton                                                                 |
| Tableau de bord          | Coquille initiale ; tableau rempli, vide, erreur API du tableau, erreur d’identité et redirection sans session |
| Route inconnue           | Réponse HTTP 404 et résultat hydraté                                                                           |

Le test navigateur compare son inventaire aux routes de la configuration des
langues. Compléter les deux lors d’un ajout. Les projets Nest vérifient les
e-mails de vérification et de mot de passe via le rendu serveur React ; les projets Rust
utilisent leur moteur Rust. Le contrôle du template source vérifie les deux
backends. La CI lance aussi la commande dans les six archives générées.

Les erreurs font échouer la commande sans filtrage ; les avertissements restent
informatifs. Le HTML produit, les traces et échecs navigateur restent dans
`output/html-check/run-*/`, ignoré par Git. Captures et documents générés ne sont
pas des ressources source. Ce contrôle vérifie la conformité HTML, pas la
compatibilité Gmail/Outlook/Apple Mail.

## Taille du code et organisation des modules

`pnpm size:check` avertit au-delà de 300 lignes de code par fichier et échoue
au-delà de 500. ESLint avertit aussi au-delà de 50 lignes par fonction
JavaScript/TypeScript. Les lignes vides et commentaires ne comptent pas ; les
chaînes et le contenu JSX restent du code. Les types API, validateurs et
traductions générés sont exclus. La politique commune et les éventuelles
exceptions bornées et justifiées appartiennent à `packages/config/source-size.mjs`.
Aucune exception n’est actuellement nécessaire.

Le contrôle passe par `pnpm project:check` et `pnpm check` dans la CI. Il couvre
JavaScript, TypeScript, Rust et CSS, y compris les scripts et tests maintenus.
Il fonctionne dans les dépôts Git comme dans les archives de projet extraites ;
sans métadonnées Git, le parcours exclut dépendances, builds et caches.

La taille signale une responsabilité à revoir, sans prouver le respect du SRP.
Garder les extractions chez leur propriétaire et regrouper les implémentations
cohérentes dans des dossiers nommés. Préserver les points d’entrée, cycles de vie
et transactions ; éviter les fragments numérotés et les dossiers plats sans cohésion.
