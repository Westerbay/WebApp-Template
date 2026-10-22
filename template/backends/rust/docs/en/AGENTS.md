# Agent instructions

Read `docs/CONTEXT.md` and relevant documents first. Inspect Git status and preserve
existing changes. Search contracts and consumers before adding shared code.

`apps/api` owns Rust runtime, auth, SeaORM entities and versioned SQLx migrations.
`apps/web` never imports server implementations. `packages/contracts` owns shared
frontend schemas; application HTTP DTOs originate in Rust OpenAPI. `packages/ui`
contains reusable primitives. Keep business rules with their owner.

Never read or edit real environment files, secrets or credentials. Never migrate,
reset or seed a remote or unverified/shared database. Do not commit, push or deploy
without explicit authorization. Do not change applied migration files; add a new
version. The API must never apply migrations automatically during startup.

Run proportionate checks, inspect the final diff, and update relevant documentation.
Use `pnpm check`, `pnpm test:integration` and `pnpm test:e2e` for auth changes.
Integration fixtures use isolated Docker resources. Follow `docs/DESIGN.md` for UI.

Keep `modules/<feature>` independent. Shared feature DTOs belong in `contracts/`.
Infrastructure and configuration never import features or composition roots.
Compose in `app.rs`, `bootstrap.rs`, `cli.rs` and `openapi/`; keep `main.rs` thin.
Configuration validates values; infrastructure owns connections and transports.
