# WebApp Template

Application web TypeScript réutilisable avec authentification email/mot de passe,
pagination par curseur, outils locaux protégés et stack d’observabilité
provisionnée pour les logs, métriques, dashboards et alertes.

## Technologies

Node.js 24.22.1, pnpm 12.11.2, Turborepo, NestJS 11/Express, TanStack Start/Router/Query/Form,
Tailwind/shadcn, Better Auth, Zod, OpenAPI/openapi-typescript/openapi-fetch,
Drizzle/PostgreSQL 17, Vitest, React Email/Nodemailer, Mailpit, Paraglide,
Sonner, Playwright, Docker Compose, Pino, Grafana, Prometheus, Loki, Alloy,
Blackbox Exporter, GitHub Actions et Gitleaks.

## Démarrage

Prérequis : Node.js 24.22.1, pnpm 12.11.2 et Docker.

```bash
corepack enable pnpm
corepack install
pnpm --version # 12.11.2
pnpm install --frozen-lockfile
cp .env.example .env
pnpm run setup
pnpm dev
```

Web : `http://localhost:3000` ; API : `http://localhost:3001` ; Swagger : `/docs`
sur l’API ; santé : `/health/live` ; Mailpit : `http://localhost:8025` ;
PostgreSQL : port 5433. L’installation démarre l’infrastructure et applique les
migrations protégées sans créer de données de test.

## Observabilité

Le template inclut quatre dashboards Grafana alimentés par les métriques
Prometheus et les logs API structurés dans Loki. Le provisionnement des
dashboards, les collecteurs et les règles d’alerte initiales sont dans
`infra/observability` et versionnés avec l’application.

| Dashboard           | Contenu                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| API overview        | Trafic, erreurs, percentiles de latence, readiness et versions déployées.                                      |
| API routes and logs | Résultats par route, routes lentes ou en échec, erreurs structurées et corrélation par identifiant de requête. |
| API infrastructure  | Ressources Node.js, connexions et charge SQL PostgreSQL, ressources Valkey et état de la supervision.          |
| API auth and email  | Résultats HTTP d’authentification, blocages par quota et résultats/durée du transport email.                   |

Après l’installation normale du projet, démarrer la stack d’observabilité locale
et l’application :

```bash
pnpm logs:up
pnpm dev:logs
```

Ouvrir [Grafana](http://localhost:3002/d/webapp-template-api-overview). Les statistiques SQL
PostgreSQL sont activées par défaut dans la stack d’observabilité ; le Compose
standard de développement précharge `pg_stat_statements` et l’installe dans
les nouvelles bases. Les volumes existants nécessitent l’installation explicite
décrite dans le [guide des performances PostgreSQL](docs/POSTGRESQL-PERFORMANCE.md).

Essayer les dashboards sans installer le projet avec `pnpm logs:preview`.
Cette commande crée des services isolés et du trafic d’exemple, puis retire ses
propres ressources avec Ctrl+C. `pnpm logs:check` valide les règles d’alerte ;
`pnpm logs:test` exerce métriques, logs, sondes et requêtes des dashboards contre
des services isolés sans `.env` local.

La stack locale est optionnelle. Les environnements déployés nécessitent un
accès, un stockage, une installation d’extension et un acheminement des
notifications gérés par la plateforme. Voir le
[guide d’observabilité](docs/OBSERVABILITY.md) pour les définitions des métriques,
la confidentialité, l’intégration en production et les procédures de diagnostic,
et le [guide de développement](docs/DEVELOPMENT.md) pour les commandes.

## Langues

Les catalogues actifs sont dans `packages/i18n/messages` ; les langues supportées
et celle par défaut sont configurées dans `packages/i18n/project.inlang/settings.json`.
Les chemins publics sont dans `packages/i18n/routing.json`. Les projets
monolingues omettent les préfixes ; les projets multilingues préfixent chaque
langue. Les identifiants de code et routes internes restent anglais.

## Commandes

```bash
pnpm check                    # format, lint, types, tests unitaires, contrats, docs, builds
pnpm test:integration         # auth/API réelles avec services éphémères dédiés
pnpm test:e2e                 # parcours mobile auth et pagination
pnpm docs:check
pnpm project:check
pnpm api:generate
pnpm api:check
pnpm db:generate
pnpm db:migrate
pnpm db:seed -- --scenario auth
pnpm db:seed -- --scenario auth --clean
pnpm db:seed -- --all
pnpm db:studio
pnpm dev:infra
pnpm dev:down
```

Les données de test sont créées explicitement, nécessitent le mode fixture et
restaurent deux comptes de référence ainsi que 60 profils déterministes.
Les emails locaux sont capturés par Mailpit.

## Structure

```text
apps/api             API NestJS et intégrations serveur
apps/web             application TanStack Start
packages/contracts   schémas et interfaces partagés
packages/core        règles métier et ports purs lorsque nécessaires
packages/database    schémas, migrations et client Drizzle
packages/email       modèles email et transport serveur
packages/i18n        catalogues sélectionnés et runtime Paraglide généré
packages/ui          primitives et styles partagés
infra                initialisation PostgreSQL et configuration d’observabilité
docs                 documentation actuelle du projet
```

Better Auth possède `/api/auth` ; le client web typé consomme l’OpenAPI Nest.
Les deux clients utilisent les cookies de session. Lire
[docs/CONTEXT.md](docs/CONTEXT.md) et [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
avant de modifier le projet.

## Licence

WebApp Template utilise la [licence MIT](LICENSE). Lors de sa réutilisation,
merci de le mentionner et de fournir un lien vers
[son dépôt](https://github.com/Westerbay/WebApp-Template). Cette mention est
facultative et ne constitue pas une condition supplémentaire de la licence.
