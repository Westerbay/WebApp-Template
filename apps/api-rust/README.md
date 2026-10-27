# Rust backend option

Generate a new Rust application without changing the default NestJS template:

```sh
pnpm template:create -- --backend rust --profile multilingual --output output/rust-app
pnpm template:archives -- --backend rust --profile fr --output output/rust-archives
```

Omitting `--backend` selects `nestjs`, including the existing archive names.
Rust supports the same `en`, `fr` and `multilingual` profiles; its archives append
`-rust`. Release validation builds all six combinations before publication.
Generation never connects to a database or reads real environment files.

## Ownership and generated application

This directory owns the Rust API source, integration fixtures, embedded migration
source. Backend-specific generated documentation and configuration live in
`template/backends/rust/`; maintainer checks live in `scripts/template-rust/`. `scripts/template-rust.mjs`
selects those files; frontend, UI, contracts and i18n remain shared. Generated
applications contain Rust in `apps/api`, plus its Docker runtime, package commands,
CI and matching documentation. Nest, Drizzle and server TypeScript packages/tools
are omitted. Node builds/serves the frontend and runs development tools; it is not
an authentication service beside Rust.

Generated projects include `.env.example` for local PostgreSQL/Mailpit and
`.env.production.example` for deployed origins, PostgreSQL and SMTP. The latter
comes from [production.env.example](../../template/backends/rust/production.env.example); replace its placeholders
and keep real environment files untracked. Public URLs are read from the environment,
not from test fixture defaults.

The generated [development guide](../../template/backends/rust/docs/en/docs/DEVELOPMENT.md) documents setup,
production environment, migrations, container deployment and verification. A
[French guide](../../template/backends/rust/docs/fr/docs/DEVELOPMENT.md) ships in French projects. Email catalogs
come from the locale packs; generated `api:generate` also synchronizes their
embedded copies and shared auth constraints. `api:check` detects drift.

## Architecture

The [architecture guide](../../template/backends/rust/docs/en/docs/ARCHITECTURE.md) maps composition roots,
independent feature modules, shared DTOs, configuration and infrastructure.
`src/lib.rs` exposes the crate; `app.rs` assembles the router, `bootstrap.rs`
acquires resources, and each feature owns its HTTP handler and query.

## Runtime and migrations

`src/config/runtime.rs` validates PostgreSQL URLs, persistent secrets, HTTPS origins and
SMTP before opening connections. Staging/production require verified PostgreSQL
TLS and enable HIBP for new passwords. SMTP requires implicit TLS or STARTTLS;
staging recipients use an exact allowlist. Production rejects capture/memory mail.
The binary reads process environment, never an environment file.

The template starts with one `202610190001_initial.sql` migration containing
identity and shared quotas. SQLx embeds files from `migrations/`, stores versions and checksums,
locks concurrent migrators and applies each PostgreSQL migration transactionally.
Serving only verifies history; absent, pending, unknown or modified history fails
startup. Explicit `--migrate` is separate. Development migration checks loopback,
configured database identity and fixture mode; tests additionally require an owned
run. Deployed commands require the exact `hostname:port/database` target.
There is no automatic adoption of an existing Nest schema, password migration,
reset command or destructive down migration.

The production image has a Rust-only executable, runs as an unprivileged UID and
excludes the `fixtures` feature. The generated Compose example uses read-only
filesystem, health checks and external PostgreSQL/SMTP. Deployment still requires
reviewed secrets, migration approval, TLS termination, backups and platform probes.
Sanitized JSON logs and health probes are supplied. The Nest-specific Prometheus,
Valkey and Grafana integrations are not included in this backend.

## Authentication parity and dependency limits

Better Auth RS is pinned to revision
`9f91cd7fdb8a5f73a9c69d5c56d363468a7dc281` (`1.0.0-alpha.3`); retain `Cargo.lock`
and use `--locked`. It remains an alpha dependency, not a security audit or a promise
of compatibility with every Better Auth plugin.

Public plugin adapters in `src/infrastructure/auth/signup.rs` and `src/infrastructure/auth/verification.rs` supply automatic
verification mail, block unverified signin before session issuance, enforce strict
expiry and validate callback redirects. Exact-byte Argon2 and HIBP preserve password
rules; rejected/unavailable reset checks consume links without changing passwords
or existing sessions. Signin is independent of HIBP availability.

Auth and application quotas use atomic shared PostgreSQL admission and fail closed.
Socket peers identify clients; forwarded IP headers are discarded, so clients of a
reverse proxy share its quota. Mail renders the same French/English subjects,
actions and expiry text and drains background SMTP work on shutdown. Email requests
remain non-enumerating. Delivery after a process crash is not guaranteed.

The installed Better Auth 1.7.4 SDK and actual React frontend exercise signup,
verification, signin, resend, reset/reuse, session revocation and logout in Chromium.
The sample private `/api/users` contract preserves bounded cursor search. Utoipa
exports application DTOs to frontend TypeScript and Orval-generated Zod validators
without a database. Queries validate responses before caching them. Upstream auth OpenAPI only
lists routes at this revision, so it does not replace the auth SDK's DTOs.

## Maintainer validation

Use Node 24 / pnpm 12 and Docker:

```sh
pnpm template:check
sh scripts/template-rust/check.sh
sh scripts/template-rust/runtime-check.sh
node scripts/template-rust/frontend-check.mjs
pnpm api:generate:rust
pnpm api:check:rust
```

`check.sh` covers SQLite, PostgreSQL, Mailpit, HIBP fixtures, migration concurrency,
checksums/rollback, production config, formatting and Clippy. `runtime-check.sh`
uses the normal binary configuration, explicit/repeated migrations, readiness and
restart. The frontend command generates all three Rust projects and runs their own
SDK/browser harnesses, covering both multilingual locales. Diagnostics are saved
under ignored `output/`. The template archive tests also cover NestJS unchanged.

Every integration run owns a unique private Compose network, PostgreSQL in tmpfs,
and Mailpit. Frontend services publish loopback ports only. Cleanup removes only
that run's containers/network. Generated fixture build caches stay under `apps/api/target/fixture`, separate
from other projects and native builds. Maintainer-only checks retain the temporary
`/tmp/skull-rust-*` cache.
The tests exercise local HIBP/SMTP fixtures, not a real production provider or an
existing account migration.

Upstream references: [SQLx migrator](https://docs.rs/sqlx/0.8.6/sqlx/migrate/struct.Migrator.html),
[email/password](https://github.com/better-auth-rs/better-auth-rs/blob/9f91cd7fdb8a5f73a9c69d5c56d363468a7dc281/crates/api/src/plugins/email_password.rs),
[verification](https://github.com/better-auth-rs/better-auth-rs/blob/9f91cd7fdb8a5f73a9c69d5c56d363468a7dc281/crates/api/src/plugins/email_verification/token.rs).
