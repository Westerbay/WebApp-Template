# Architecture

The Rust backend keeps the same ownership boundaries as the NestJS backend,
using Rust modules within one crate. Adding a feature does not require another
crate, a generic repository or an extra service layer.

```text
apps/api/src/
  main.rs                  process exit handling
  cli.rs                   server, migration and OpenAPI commands
  app.rs                   router and dependency composition
  bootstrap.rs             resource acquisition and startup cleanup
  server.rs                HTTP serving and graceful shutdown
  config/                  validated settings; no connections or transports
  contracts/               application DTOs shared by feature modules
  modules/
    identity/              verified current-user endpoint
    users/                 HTTP handler, query DTOs and cursor query
    health/                liveness and database readiness
  infrastructure/
    auth/                  Better Auth assembly and compatibility adapters
    database/              connection, SeaORM entities and migration runner
    email/                 localized rendering and SMTP transport
    http/                  socket identity, request IDs and sanitized logs
    rate_limit/            atomic admission store and HTTP quotas
  openapi/                 application contract composition
  fixtures/                disposable frontend server; fixtures feature only
```

`main.rs` calls the CLI. `app.rs`, `bootstrap.rs`, `cli.rs` and `openapi/` are
composition roots: they may assemble feature modules, configuration and concrete
adapters. Feature modules stay independent of one another; shared response DTOs
belong in `contracts/`. Infrastructure and configuration never import features or
composition roots. Configuration validates values; database connections and SMTP
transports are created by their infrastructure adapters during bootstrap.

Feature implementation modules are private outside the crate. Auth compatibility
adapters and the users SQL query are private to their owner. Rust visibility
controls these entry points; the workspace dependency checker covers TypeScript
imports, not Rust dependency directions. Keep those directions when adding modules.

The users HTTP handler checks the session and decodes query inputs. Its local
`list_users.rs` owns validation, parameterized search and cursor pagination;
there is no generic repository layer. `/api/users` requires a verified session,
a unique ID cursor and bounded literal case-insensitive search. The identity and
users modules share their wire user shape without importing each other's code.

`infrastructure/auth` composes automatic verification mail, blocks unverified
signin before session creation and returns opaque success for duplicate signup.
Its verification adapter checks strict expiry and trusted redirects. Exact-byte
Argon2 uses HIBP for new passwords in staging/production; signin is independent
of HIBP. Failed reset validation consumes the link. Shared PostgreSQL quota
admission is atomic and fails closed. Socket peers identify clients; forwarded
IP headers are ignored, so clients of a reverse proxy share its quota.

`infrastructure/database` owns SeaORM entities and the SQLx migration runner;
`migrations/` owns immutable PostgreSQL schema versions. Startup only checks
history; the explicit migration command applies SQL. SQLite initialization is
reserved for disposable tests. Shutdown drains mail and closes the database.

The frontend consumes cookies through Better Auth's SDK and application DTOs
through OpenAPI. `pnpm api:generate` exports Utoipa, generates HTTP types with
openapi-typescript and response validators with Orval targeting Zod 4, without
a database or SMTP connection. `lib/api/contracts.ts` exposes these validators
and derived identity types. Identity and users queries parse successful responses
before caching them in TanStack Query; HTTP errors retain their existing handling.
`openapi-fetch` remains the typed client. Form validation stays with its feature.

`packages/contracts` owns shared frontend constraints and pagination types,
`packages/i18n` owns copy/public paths, and `packages/ui` owns primitives. Web
never imports server implementations. Upstream auth OpenAPI remains only a route
inventory at the pinned revision, separate from the SDK's auth types.
