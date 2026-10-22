# Reuse

- `packages/contracts/src/auth.constraints.ts` owns frontend password/token limits;
  keep matching Rust enforcement in `apps/api/src/config/auth.rs` synchronized.
- `apps/api/src/config/runtime.rs` owns validated startup and migration authorization.
- `apps/api/src/infrastructure/rate_limit/store.rs` supplies atomic shared admission and fail-closed errors.
- `apps/api/src/infrastructure/email/mail.rs` / `infrastructure/email/smtp.rs` render localized email and apply transport rules.
- `apps/api/src/openapi/mod.rs` and endpoint DTOs own application API generation.
- `apps/web/src/lib/api/client.ts` is the typed cookie-based application client.
- `apps/web/src/features/auth/queries/current-user.queries.ts` supplies fresh identity.
- `apps/web/src/lib/query/private-cache.ts` clears private queries on auth changes.
- `apps/web/src/lib/query/use-cursor-infinite-query.ts` supplies cursor navigation.
- `packages/i18n/src/routing.ts` supplies localized links and callback URLs.
- `packages/ui/src/components` contains reusable interface primitives.

See [architecture](ARCHITECTURE.md) for boundaries and [development](DEVELOPMENT.md)
for operational commands.
