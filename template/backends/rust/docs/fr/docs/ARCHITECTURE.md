# Architecture

Le backend Rust conserve les frontières du backend NestJS dans les modules d'une
seule crate. Une fonctionnalité ne nécessite pas une crate, un repository générique
ou une couche de service supplémentaire.

```text
apps/api/src/
  main.rs                  sortie du processus
  cli/                     analyse et dispatch des commandes, migrations et sonde santé
  app.rs                   assemblage du routeur et des dépendances
  bootstrap.rs             acquisition des ressources et nettoyage au démarrage
  server.rs                démarrage du serveur HTTP et arrêt propre
  config/                  paramètres validés, sans connexion ni transport
  contracts/               DTO applicatifs partagés entre modules
  modules/
    identity/              utilisateur courant vérifié
    users/                 handler HTTP, DTO et requête avec curseur
    health/                sondes de vie et disponibilité PostgreSQL
  infrastructure/
    auth/                  assemblage Better Auth et adaptateurs de compatibilité
    database/              connexion, entités SeaORM et exécution des migrations
    email/                 rendu localisé et transport SMTP
    http/                  adresse socket, identifiants et logs nettoyés
    rate_limit/            compteurs atomiques et quotas HTTP
  openapi/                 assemblage des contrats applicatifs
  fixtures/                serveur jetable, uniquement avec la feature fixtures
```

`main.rs` appelle la CLI. `app.rs`, `bootstrap.rs`, `cli/` et `openapi/`
assemblent modules, configuration et adaptateurs. Les modules métier restent
indépendants ; leurs DTO communs appartiennent à `contracts/`. Infrastructure et
configuration n'importent ni les fonctionnalités ni les racines d'assemblage.
La configuration valide les valeurs ; les adaptateurs créent les connexions et
transports au démarrage.

Les fonctionnalités sont privées à la crate ; les adaptateurs d'auth et la
requête SQL utilisateurs sont privés à leur propriétaire. Rust contrôle cette
visibilité. Le vérificateur de dépendances du workspace couvre TypeScript,
pas les directions de dépendance Rust : les respecter lors de l'ajout de modules.

Chaque fonctionnalité possède son `router(database)` et son `ApiDocument`
OpenAPI dans `modules/<feature>/mod.rs`. Ajouter ses endpoints et leur quota
localement ; enregistrer une nouvelle fonctionnalité une seule fois dans `app.rs`
et son document dans `openapi/mod.rs`. Le socle HTTP gère l’identité réseau,
CORS et les logs avant les politiques du module : les requêtes preflight restent
exemptées des contrôles de session et de quota. Les logs utilisent les métadonnées
de route Axum, sans liste parallèle des chemins. Les sondes et OpenAPI restent
hors quotas applicatifs ; chaque module conserve sa propre politique de quota.

Le handler utilisateurs vérifie la session et décode les entrées ; `list_users.rs`
possède validation, recherche paramétrée et pagination. Aucun repository générique
n'est ajouté. `/api/users` exige une session vérifiée, un curseur ID unique et une
recherche littérale, insensible à la casse et bornée. Les modules identité et
utilisateurs partagent le DTO commun sans importer leurs implémentations.

`infrastructure/auth` envoie la vérification, bloque la connexion non vérifiée
avant émission de session et conserve un succès opaque pour les doublons.
L'adaptateur vérifie expiration stricte et redirections autorisées. Argon2 conserve
les octets du mot de passe ; HIBP vérifie les nouveaux mots de passe en
staging/production. La connexion reste indépendante de HIBP. Un reset refusé
consomme le lien. PostgreSQL partage les quotas atomiques et leurs pannes ferment
l'accès. L'adresse vient du socket ; un reverse proxy partage donc son quota.

`infrastructure/database` possède les entités SeaORM et l'exécuteur SQLx ;
`migrations/` contient les versions SQL immuables. Le serveur vérifie l'historique ;
seule la commande explicite applique les migrations. SQLite reste réservé aux
tests jetables. L'arrêt attend les emails puis ferme PostgreSQL.

Le frontend utilise le SDK Better Auth et les DTO OpenAPI. `pnpm api:generate`
exporte Utoipa, génère les types HTTP avec openapi-typescript et les validateurs
de réponse avec Orval ciblant Zod 4, sans base ni SMTP. `lib/api/contracts.ts`
expose ces validateurs et les types d’identité déduits. Les queries identité et
utilisateurs valident les réponses réussies avant leur mise en cache par TanStack
Query ; les erreurs HTTP conservent leur traitement existant. `openapi-fetch`
reste le client typé. La validation des formulaires appartient à leur fonctionnalité.

`packages/contracts` possède les contraintes partagées et types de pagination,
`packages/i18n` les traductions et chemins, et `packages/ui` les primitives.
Le web n'importe jamais le serveur. Les types du SDK d'auth restent séparés de
l'inventaire OpenAPI upstream.
