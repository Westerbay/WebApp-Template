# PostgreSQL

The Rust API uses a bounded SeaORM/SQLx pool, indexed user/session/account lookups,
cursor pagination and an indexed quota table. A request admits/increments quotas
atomically in PostgreSQL; consider database capacity when scaling API replicas.

Local Compose preloads `pg_stat_statements` using
[the local initialization script](../infra/postgres/query-statistics.sql).
Existing database volumes do not rerun initialization. Production extensions,
preload configuration, read-only diagnostic roles and query statistics retention
belong to the platform; application migrations never install extensions.
Avoid exporting SQL text, credentials, query strings or personal data in logs.
Use aggregate statistics and query plans with reviewed, non-sensitive inputs.
