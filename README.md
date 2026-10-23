# WebApp Template

A reusable TypeScript web application with email/password authentication,
cursor pagination, guarded local development tools and a provisioned observability
stack for logs, metrics, dashboards and alerts.

## Stack

Node.js 24, pnpm 12, Turborepo, NestJS 11/Express, TanStack Start/Router/Query/Form,
Tailwind/shadcn, Better Auth, Zod, OpenAPI/openapi-typescript/openapi-fetch,
Drizzle/PostgreSQL 17, Vitest, React Email/Nodemailer, Mailpit, Paraglide,
Sonner, Playwright, Docker Compose, Pino, Grafana, Prometheus, Loki, Alloy,
Blackbox Exporter, GitHub Actions and Gitleaks.

## Start

Requires Node.js 24, pnpm 12 and Docker.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm run setup
pnpm dev
```

Web: `http://localhost:3000`; API: `http://localhost:3001`; Swagger: `/docs` on the
API; health: `/health/live`; Mailpit: `http://localhost:8025`; PostgreSQL: port 5433.
Setup starts infrastructure and applies guarded migrations without seeding.

## Observability

The template includes four Grafana dashboards backed by Prometheus metrics and
structured API logs in Loki. Dashboard provisioning, collectors and starter
alert rules live in `infra/observability` and are versioned with the application.

| Dashboard           | What it shows                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| API overview        | Traffic, errors, latency percentiles, readiness and deployed versions.                              |
| API routes and logs | Route outcomes, slow/failing routes, structured errors and request-ID correlation.                  |
| API infrastructure  | Node.js resources, PostgreSQL connections and SQL workload, Valkey resources and monitoring health. |
| API auth and email  | Authentication HTTP outcomes, quota blocks and email transport outcomes/duration.                   |

After the normal project setup, start the local observability stack and application:

```bash
pnpm logs:up
pnpm dev:logs
```

Open [Grafana](http://localhost:3002/d/webapp-template-api-overview). PostgreSQL SQL statistics
are enabled by default in the observability stack; standard development Compose
preloads `pg_stat_statements` and installs it in fresh databases. Existing volumes
need the explicit installation described in the
[PostgreSQL performance guide](docs/POSTGRESQL-PERFORMANCE.md).

Try the dashboards without project setup using `pnpm logs:preview`. It creates
isolated services and sample traffic, then removes its owned resources on Ctrl+C.
`pnpm logs:check` validates alert rules; `pnpm logs:test` exercises metrics, logs,
probes and dashboard queries against isolated services without a local `.env`.

The local stack is optional. Deployed environments need platform-managed access,
storage, extension setup and alert notification routing. See the
[observability guide](docs/OBSERVABILITY.md) for metric definitions, privacy,
production integration and runbooks, and the
[development guide](docs/DEVELOPMENT.md) for commands.

## Languages

Active catalogs live in `packages/i18n/messages`; supported languages and the
default are configured in `packages/i18n/project.inlang/settings.json`.
Public paths are configured in `packages/i18n/routing.json`. Single-language
projects omit locale prefixes; multilingual projects prefix every language.
Code identifiers and internal routes stay English.

<!-- template-maintainers:start -->

Maintaining the source template? See the [distribution guide](template/README.md)
for profile generation, archive validation and versioned releases.
This tooling and its documentation are excluded from generated applications.

<!-- template-maintainers:end -->

## Commands

```bash
pnpm check                    # formatting, lint, types, unit tests, contracts, docs, builds
pnpm test:integration         # real auth/API with owned ephemeral services
pnpm test:e2e                 # mobile auth and pagination journey
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

Seeding is explicit, requires fixture mode and restores two reference accounts
plus 60 deterministic demo profiles. Local email is captured by Mailpit.

<!-- template-maintainers:start -->

Backend sources live in `apps/api-nestjs` and `apps/api-rust`. The root development
commands run NestJS by default. Generation selects one backend and places it in
`apps/api`; Rust maintainer tools live in `scripts/template-rust/` and its generated
configuration/documentation in `template/backends/rust/`.

<!-- template-maintainers:end -->

## Structure

```text
apps/api-nestjs      NestJS API and server integrations
apps/web             TanStack Start application
packages/contracts   shared schemas and interfaces
packages/core        business rules and pure ports when required
packages/database    Drizzle schemas, migrations and client
packages/email       server email templates and transport
packages/i18n        selected catalogs and generated Paraglide runtime
packages/ui          shared primitives and styles
infra                PostgreSQL initialization and observability configuration
docs                 current project documentation
```

Better Auth owns `/api/auth`; Nest OpenAPI is consumed by the typed web client.
Both clients use session cookies. Read [docs/CONTEXT.md](docs/CONTEXT.md) and
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) before changing the project.

## License

WebApp Template uses the [MIT license](LICENSE). When reusing this project, please
mention it and link to [its repository](https://github.com/Westerbay/WebApp-Template).
Attribution is optional and is not an extra license condition.
