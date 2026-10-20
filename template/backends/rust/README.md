# Rust API foundation

This standalone API introduces Axum and a pinned Better Auth RS backend under
`template/backends/rust`. The application and generator still default to NestJS;
the Rust generator option is introduced by a later pull request in this stack.

## Architecture

```text
src/
  main.rs, cli.rs            process entry and explicit commands
  app.rs, bootstrap.rs      dependency composition and resource acquisition
  server.rs                 serving and graceful shutdown
  config/                   validated values, without connections/transports
  contracts/                shared application response DTOs
  modules/
    identity/               verified current user
    users/                  HTTP handler, DTOs and cursor query
    health/                 liveness and PostgreSQL readiness
  infrastructure/
    auth/                   Better Auth and compatibility adapters
    database/               connection, entities and versioned migrations
    email/                  localized rendering and SMTP
    http/                   request IDs, logs and socket identity
    rate_limit/             atomic PostgreSQL admission
  openapi/                  application contract composition
  fixtures/                 disposable frontend server, feature gated
```

Feature modules are independent. Infrastructure and configuration never import
features or composition roots. Only composition roots assemble them. Shared wire
DTOs belong in `contracts/`; the users query remains local to its feature.
Rust visibility hides feature internals and auth compatibility adapters. Keep one
crate unless a concrete dependency boundary requires another; do not add empty
service, repository or domain layers.

## Behavior and verification

The template starts with one `202610190001_initial.sql` migration covering identity
and shared quotas. Use a fresh disposable local database if you applied the earlier
prototype history. The normal server reads URLs, database and SMTP from its process
environment; the localhost defaults belong to test helpers.

The API covers signup, email verification, signin, password reset and signout,
plus verified `/api/me` and cursor-based `/api/users`. It preserves exact password
bytes, opaque duplicate signup, HIBP checks on new passwords, shared quotas and
localized SMTP. HIBP/SMTP integration tests use local fixtures. Versioned SQLx
migrations are explicit; normal startup only validates migration history.

With Node 24, pnpm 12 and Docker, run from the repository root:

```sh
sh template/backends/rust/check.sh
```

The command checks shared assets, SQLite/PostgreSQL auth and service tests,
migration concurrency/checksums/rollback, formatting and Clippy. Every run owns a
private network with disposable PostgreSQL and Mailpit. No remote database or
real environment file is needed. The binary's `--openapi` command needs no database.

Better Auth RS is pinned to revision
`9f91cd7fdb8a5f73a9c69d5c56d363468a7dc281`, an alpha release. This is a new-project
schema, not a migration of existing NestJS accounts. SMTP delivery has no durable
queue. Production packaging and generator wiring follow in separate pull requests.

## Production packaging

`Dockerfile.runtime` builds a Rust-only executable with the fixtures feature off.
The final image runs as UID 10001. `compose.production.yml` expects a reviewed image
and an external environment file; it uses a read-only filesystem, dropped
capabilities, health checks and graceful shutdown. `env.example` documents the
configuration shape without supplying deployed credentials.

Staging and production validate HTTPS origins, a persistent secret, verified
PostgreSQL TLS and SMTP settings. Capture mode is not allowed in production.
Run `--migrate --target hostname:port/database` explicitly before serving; the
server refuses absent, pending or modified migration history. Review the exact
target and deployment credentials before any real deployment. There is no down
migration or automatic adoption of an existing NestJS schema.

Run the disposable normal-runtime check from the repository root:

```sh
sh template/backends/rust/runtime-check.sh
```

It verifies migration refusal, explicit/idempotent migration, readiness and restart
against an owned local database. `cli.mjs` is a development-command asset for the
upcoming generator; the deployed API reads process environment directly.

`production.env.example` provides public HTTPS origins and external PostgreSQL/SMTP
placeholders. Copy it to a private deployment environment file or inject the same
variables through your platform. Compose uses `--env-file`; the Rust binary consumes
process variables and never loads a secret file implicitly. The generator later
emits this asset as `.env.production.example`.
