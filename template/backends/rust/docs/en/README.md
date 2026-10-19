# Web application — Rust API

TanStack Start, React, Zod and Paraglide in `apps/web` / `packages/i18n`, with an
Axum + Better Auth RS API and PostgreSQL in `apps/api`. The backend runs entirely
in Rust. Node 24 and pnpm 12 build and serve the frontend and run tooling.

Use Rust 1.90 (rustfmt and Clippy), a C toolchain, OpenSSL development libraries,
and Docker. Copy `.env.example` to `.env` yourself, replace the secret with at
least 32 random characters, then run:

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

Open the frontend at localhost:3000 and Mailpit at localhost:8025. API development
runs `cargo run`; restart it after editing Rust. Vite reloads frontend changes.
Read [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md) and
[product rules](docs/PRODUCT.md) before extending the application.

Better Auth RS is pinned to an alpha revision. This is an alternative for new
projects, not an automatic migration of existing Nest accounts or password hashes.
The Rust variant supplies sanitized JSON logs and health probes; it does not
include the Nest Valkey/Grafana adapters or their metrics dashboards.

Based on [WebApp Template](https://github.com/Westerbay/WebApp-Template), MIT.
