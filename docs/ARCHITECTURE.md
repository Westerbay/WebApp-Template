# Architecture

<!-- template-maintainers:start -->

`apps/api-nestjs` owns the NestJS backend; `apps/api-rust` owns the Rust crate.
They are alternative backends. The generator emits the selected backend as
`apps/api`, retaining the shared frontend and contracts. Rust-only generated
configuration and documentation live in `template/backends/rust`; validation of
the source template lives in `scripts/template-rust`. The root pnpm workspace
runs NestJS; the Rust crate is checked separately through Cargo/Docker.

<!-- template-maintainers:end -->

## Boundaries

```text
apps/web → packages/contracts, packages/ui, packages/i18n, generated API types
apps/api-nestjs → packages/contracts, packages/database, packages/email
packages/database → Drizzle ORM, PostgreSQL
packages/core → framework-independent ports
```

NestJS composes the API; Express mounts Better Auth under `/api/auth` before
Nest's JSON parser. Better Auth owns users, accounts and sessions. Nest protects
its controllers with a global session guard unless a route is public.
`packages/core` holds only technology-independent ports, currently
`EmailSender`. Contracts own boundary schemas; database owns persistence; UI
owns reusable primitives. Web never imports server modules.

`pnpm boundaries:check` enforces these dependency directions with
[dependency rules](../packages/config/dependency-cruiser.mjs), including
type imports, dynamic imports and resolved aliases. Core ports have no external
dependencies; contracts depend only on their own schemas and Zod; UI primitives
do not depend on business packages. Shared packages never import applications.

Auth route files live in `apps/web/src/routes/(auth)`. Parenthesized route groups
organize files without adding URL segments or layouts; internal and localized
paths remain unchanged. Add a pathless protected layout only when multiple
protected routes need a shared session check or shell.

Routes compose navigation, metadata and feature components. Each feature owns
its server state: `queries/` contains query keys, reads and reusable query options;
`mutations/` contains writes and their cache effects. `hooks/` owns forms,
navigation and screen interactions, consuming those options with TanStack Query.
Create these folders only when needed. Shared clients and generic cache mechanisms
live in web `lib`; domain queries remain with their feature. Better Auth returns
provider errors as results, so auth consumers check `result.error`; only successful
identity writes clear private queries, before navigation.
The home route composes the auth account summary and the users table; auth does
not own the dashboard. The application header composes auth session actions.
Dependency rules keep each `features/<name>` independent of other features and
of routes/application-shell components. Shared `lib` mechanisms depend on
neither features nor composition. These rules apply to new feature folders
without adding their names to configuration. Compose features at the route or
shell boundary; extract a shared mechanism only for a concrete common need.
Configurations stay with the module that enforces them. No extra repository or
port layer is needed for the existing auth and sample users flows.

API `modules/<name>` are independent of one another. Infrastructure and
configuration never import application modules; none of these folders import
the runtime or OpenAPI composition roots. `app.ts`, `bootstrap.ts` and `openapi/`
compose their dependencies. Boundary checks cover new module names automatically
while allowing module-local code, shared infrastructure and persistence adapters.

## Request and identity flow

Zod validates Nest inputs and serializes responses. Nest errors use a stable
envelope and request ID; Better Auth keeps its own responses. OpenAPI is
generated from Nest controllers with inert providers and produces web client
types without a database or SMTP connection. Both API clients send session
cookies. The web reads the API URL through `lib/api/config.ts`.

The Better Auth HTTP adapter derives telemetry route templates from configured
endpoint metadata using Better Auth's routing engine. It records only the matched
template on the request; logs and metrics share that template. Nest routes use
Express metadata automatically. Neither requires a parallel endpoint list.

Protected route entry makes a fresh `/api/me` check. Auth transitions cancel
and remove private queries while preserving public ones. The current-user
response exposes only ID, name, email and verification status. Internal
redirect targets are validated before navigation.

Better Auth checks new passwords against Have I Been Pwned in staging and
production; development and tests stay offline. Checker failures reject the
password write. A rejected or failed password reset consumes its link, so the
user must request another. Better Auth owns auth rate limits in PostgreSQL. Nest's default
quotas are process-local and use the socket peer; probes are exempt. Optional
Valkey shares Nest quotas across replicas. A failed enabled shared quota check
returns 503 rather than silently falling back to local counters.

## Sample users and pagination

`/api/users` requires a verified session. Its query schema bounds page size,
cursor and optional name/email search. Drizzle uses a unique ID order, the
matching cursor predicate and `limit + 1` rows. The shared page builder returns
`{ items, nextCursor }`. Search uses parameterized case-insensitive matching
and treats wildcard characters literally.

The web hook wraps `useInfiniteQuery`; query keys include page size and applied
search. The sample feature owns the debounce, cached navigation, retry and table
rendering. Search changes reset navigation. No total count or random page
access is implied by this cursor contract.

## Localization and email

Paraglide compiles the active catalogs and localized public paths from
`packages/i18n`. Code identifiers and internal routes remain English. A
single-language project has no locale prefix; a multilingual project prefixes
every public route. TanStack Router rewrites URLs, while server middleware
isolates SSR locale state. API paths remain unchanged.

Links use internal paths; auth callbacks derive their public URL from the
current locale. The API accepts callback locale only from its configured web
origin and falls back to the base locale otherwise. Email renders localized
HTML/text. Development uses Mailpit; production requires explicit SMTP
configuration, and staging SMTP uses an exact recipient allowlist.

## Operations and optional integrations

Pino emits sanitized HTTP logs with request IDs. Readiness checks PostgreSQL
and enabled Valkey; shutdown drains email and closes resources. Migration and
seed CLIs reject remote or unverified database targets before connecting.

The process entry point installs shutdown signal handlers after `bootstrap.ts`
starts the API. Startup validates configuration before acquiring resources and
uses the same idempotent cleanup on failure as normal shutdown: stop HTTP, drain
email, close the metrics listener and registry, then Valkey and PostgreSQL.
Every remaining close is attempted if one fails; startup and cleanup errors
remain available together when both fail. Nest throws creation errors instead
of terminating the process before cleanup can run.

The optional observability stack sends sanitized JSON through Alloy to Loki and
exposes process/HTTP/email metrics on a separate, opt-in private HTTP
listener for Prometheus. A Blackbox probe checks readiness outside the API process.
Grafana provisions four dashboards; Prometheus evaluates starter alert rules.
Alloy embeds upstream PostgreSQL and Redis/Valkey exporters. Dependency collection
is read-only and independent of API processes; its failures do not affect requests. Service, environment and instance identity are indexed;
request and user identifiers never become metric/index labels.

SQL workload collection defaults to enabled in the observability stack. A separate
PostgreSQL exporter executes bounded aggregate queries using `pg_stat_statements(false)`,
scoped to its configured database and role. SQL text and query identifiers stay out
of telemetry. The platform installs/preloads the extension; application migrations
do not. Infrastructure collection needs no application observer or provider port.

A separate Docker collector forwards opted-in staging or production API containers
to externally managed Loki. The platform owns deployed storage, access, probes
and notification routing. See [OBSERVABILITY.md](OBSERVABILITY.md) for operations.

Valkey is enabled explicitly and holds only Nest rolling-window counters. It
does not store sessions or application data. Its local Compose service is
loopback-only and ephemeral; deployed access and availability belong to the
platform. See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and validation commands.
