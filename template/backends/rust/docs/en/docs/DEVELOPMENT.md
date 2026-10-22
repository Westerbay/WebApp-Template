# Development

Use Node 24, pnpm 12, Rust 1.90 with Clippy/rustfmt, OpenSSL development headers,
a C toolchain and Docker. Copy `.env.example` yourself and replace the placeholder
secret before `pnpm setup`. Setup starts local PostgreSQL/Mailpit and runs the
explicit local migration command; it requires `APP_ENV=development` and
`DATABASE_FIXTURE_MODE=enabled`. It never seeds users. Use a fresh database for
this Rust application, separate from an existing Nest database.

```sh
pnpm check
pnpm test:integration
sh scripts/rust/runtime-check.sh
pnpm --filter web exec playwright install chromium
pnpm test:e2e
pnpm api:generate
pnpm docker:build
```

`pnpm check` covers formatting, Clippy, type checking, unit/auth tests, contract
drift, documentation, boundaries and builds. Integration tests use isolated
SQLite/PostgreSQL/Mailpit fixtures; the runtime smoke test exercises the normal
configuration path, explicit/repeated migrations, readiness and restart. Browser
tests run the real frontend/SDK against a Rust API initialized with versioned
migrations and runtime configuration. Artifacts go beneath `output/`.
No test reads a real environment file or uses production SMTP/HIBP credentials.
Development/tests stay offline for HIBP; its HTTP adapter uses a loopback fixture.

The [Security workflow](../.github/workflows/security.yml) audits JavaScript
dependencies and scans the literal infrastructure images from Compose with Trivy.
The production `API_IMAGE` is supplied at deployment, so its publishing pipeline
must scan that reviewed application image before deployment. It is not resolved
or pulled by this workflow. Install the [Renovate GitHub App](https://github.com/apps/renovate)
to activate the included dependency update configuration.

The template ships one initial migration, `202610190001_initial.sql`, for identity
and shared quotas. Its consolidated checksum replaces the earlier prototype history;
use a fresh disposable local database if you had applied that history. No automatic
reset or history adoption is performed.

For an application with retained data, add a new immutable timestamped SQL file in `apps/api/migrations/` and update
SeaORM entities together. `build.rs` tracks migration changes. SQLx records
versions/checksums, locks concurrent migrators and applies each PostgreSQL
migration transactionally. There is no reset or automatic down-migration command.
Run `pnpm db:migrate` only on an explicitly configured local fixture. A deployed
migration job uses the same reviewed image as the API:

```sh
webapp-api --migrate --target db.example.test:5432/application
webapp-api --check-migrations
```

For staging/production, `--target` must exactly match the configured hostname,
port and database. Remote migration is a deliberate deployment action requiring
operator approval, backup and target verification. The tool never logs the URL.
Normal startup refuses missing, pending, unknown or modified migration history.
It does not adopt an existing Nest/Drizzle schema or migrate password hashes.

The local `.env.example` intentionally uses localhost. Commands such as `pnpm dev`
and `pnpm setup` load your root `.env` explicitly. Test defaults remain isolated
from the normal server configuration.

For deployment, copy [.env.production.example](../.env.production.example) to a
private `.env.production`, replace its placeholders, or inject the same values
through the deployment platform. Docker Compose loads the selected file and passes
values to the Rust process:

```sh
docker compose --env-file .env.production -f infra/compose/production.yml config --quiet
docker compose --env-file .env.production -f infra/compose/production.yml up -d
```

Run the explicit migration job before starting the server as described above.
The file is never copied into the image. `WEB_URL` and `BETTER_AUTH_URL` are public
origins; the loopback host-port binding is separate and intended for the ingress
proxy. Keep actual environment files and credentials out of Git.

Production config is supplied through process environment, not a bundled file:
`APP_ENV`, `DATABASE_URL` with exactly one `sslmode=verify-full`, persistent random
`BETTER_AUTH_SECRET`, HTTPS origins `BETTER_AUTH_URL` and `WEB_URL`, `EMAIL_MODE=smtp`,
`EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`.
Origins contain no path/query/credentials. Staging SMTP additionally requires
exact `EMAIL_ALLOWED_RECIPIENTS`. `SMTP_SECURE=true` uses implicit TLS;
`false` requires STARTTLS. Password checking cannot be disabled in these environments.
`API_HOST` defaults to loopback and `API_PORT` to 3001. Runtime reads no `.env` file;
only explicit development pnpm commands load one. Set `VITE_API_URL` for the frontend
build, using public API origin. Cookie auth requires a compatible same-site HTTPS
frontend/API deployment and credentialed requests.

`pnpm docker:build` creates a Rust-only, non-root runtime image; fixtures are not
enabled. Publish the image only after review. The example
[production Compose file](../infra/compose/production.yml) runs that image read-only,
with external PostgreSQL/SMTP, loopback ingress, health checks and graceful shutdown.
Run the migration job first. The platform supplies secrets, TLS termination,
certificates, backups, deployment ordering and external probes. Capture/memory
email modes are rejected in production. See [operations](OBSERVABILITY.md).

`pnpm api:generate` also synchronizes embedded email catalogs and Rust auth limits
from `packages/i18n` and `packages/contracts`; `pnpm api:check` detects drift.

Local Rust PostgreSQL uses its own Compose project/volume, database identity and
loopback port 5434, separate from the default Nest template. A non-empty schema
without the application migration ledger is rejected before any DDL. URL query
parameters are limited to canonical `sslmode`, `sslrootcert`, `sslcert`, `sslkey`,
`application_name` and `options`; target overrides and TLS aliases are rejected.

Docker fixture compilation uses `apps/api/target/fixture`, isolated from other
projects and the native build. Cargo downloads may share the temporary registry
cache; PostgreSQL/Mailpit containers remain unique to each test run.
