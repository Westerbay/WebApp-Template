# Architecture

`apps/api/src/lib.rs` composes Axum, Better Auth RS, SMTP and PostgreSQL. Its
`runtime.rs` validates process environment before acquiring resources. Startup
only checks versioned migration history; `--migrate` applies embedded SQLx files.
`schema.rs` owns SeaORM entities; `migrations/` owns persisted PostgreSQL structure.
SQLite schema creation exists only for isolated unit fixtures.

`signup.rs` composes automatic verification email delivery and blocks unverified
signin before session creation. `verification.rs` checks strict token expiry and
trusted redirects. Exact-byte Argon2 hashes use HIBP on new passwords in staging
and production. Signin stays independent of HIBP. Reset links are consumed even
when password validation fails. `quotas.rs` admits and increments atomically in
PostgreSQL. HTTP client identity comes from the socket; forwarded IP headers are
ignored. A reverse proxy therefore shares a peer quota across its clients.

The web consumes cookies through Better Auth's client and application DTOs through
OpenAPI. `packages/contracts` owns independent frontend validation, `packages/i18n`
owns locale catalogs/public paths, and `packages/ui` owns primitives. No web module
imports Rust/server implementation. Protected routes recheck `/api/me` and clear
private query caches after auth changes. `/api/users` requires a verified session,
uses a unique ID cursor and literal case-insensitive search with bounded inputs.

`pnpm api:generate` exports Utoipa OpenAPI without database or SMTP access and
regenerates the frontend types. Better Auth SDK types are separate: upstream's
auth OpenAPI is only a route inventory at the pinned revision.
