# Context

This application has a TanStack frontend, a Rust Axum API, Better Auth RS identity
and PostgreSQL persistence. It supports verified email/password auth and a sample
searchable cursor-paginated user table. See [product](PRODUCT.md),
[architecture](ARCHITECTURE.md), [reuse](REUSE.md), [design](DESIGN.md),
[development](DEVELOPMENT.md), [operations](OBSERVABILITY.md) and
[PostgreSQL](POSTGRESQL-PERFORMANCE.md).

The backend uses a pinned alpha Better Auth RS revision. There is no Node API,
legacy account migration, durable email queue, OAuth, MFA or application-specific
domain. SMTP tasks are drained on graceful shutdown; a crash can lose mail.
All quotas are shared through PostgreSQL and fail closed. Production deployment,
TLS termination, backups and monitoring belong to the platform.
