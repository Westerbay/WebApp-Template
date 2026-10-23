# Context

WebApp Template is a reusable full-stack starting point. It includes a working
identity flow, a sample searchable user table and optional local infrastructure;
it does not prescribe the next project's business domain.

<!-- template-maintainers:start -->

The generator defaults to NestJS and also offers a standalone Rust backend.
See the [Rust option](../apps/api-rust/README.md) for migrations,
production configuration and differences in operational integrations.

<!-- template-maintainers:end -->

The web app uses TanStack Start, Query, Form and Table. NestJS composes the API,
Better Auth owns identity, and PostgreSQL persists data. Shared Zod contracts,
Paraglide localization and UI primitives have separate packages. See
[ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and [REUSE.md](REUSE.md) for
shared extension points.

The template supports signup, email verification, signin, password reset and
signout. The dashboard demonstrates cursor pagination and search. Development
email is captured locally. Optional Valkey shares Nest rate limits across
replicas; an optional Grafana stack provides logs, metrics, dashboards and
readiness probes and starter alert rules. PostgreSQL SQL workload statistics
default to enabled in the observability stack. Alloy embeds dependency exporters,
so infrastructure monitoring is independent of API processes. Neither Valkey nor the observability
stack is required for the base application.

## Documentation map

- [PRODUCT.md](PRODUCT.md): capabilities and durable rules.
- [ARCHITECTURE.md](ARCHITECTURE.md): boundaries and flows.
- [DESIGN.md](DESIGN.md): interface conventions.
- [REUSE.md](REUSE.md): reusable extension points.
- [DEVELOPMENT.md](DEVELOPMENT.md): setup, commands and procedures.
- [OBSERVABILITY.md](OBSERVABILITY.md): dashboards, metrics, alerts and runbooks.
- [POSTGRESQL-PERFORMANCE.md](POSTGRESQL-PERFORMANCE.md): SQL statistics setup,
  interpretation and targeted query diagnostics.

## Current limitations

The business domain beyond the sample remains undefined. Email dispatch has no
durable queue or delivery guarantee after a crash. Nest quotas are process-local
without Valkey. Localization covers interface and email copy and public page
paths, not translated content records. Production observability hosting,
notification routing and independent public probes remain platform
responsibilities; traces are not supplied. The deployed Docker log
collector is verified locally, not against a staging or production backend.

The project uses the [MIT license](../LICENSE), copyright Mathis Dubuisson.
Attribution when reusing the template is encouraged but optional.
