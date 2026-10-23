# Reuse

Use this map when adding a feature that needs an existing shared capability.
List an entry only when it has a plausible consumer beyond its original feature
and a stable owner. Keep feature-specific code and test helpers near their feature.

## Contracts and localization

- `packages/contracts/src/auth.constraints.ts` owns password limits and token
  lifetimes used by validation, auth configuration and email rendering.
- `packages/contracts/src/pagination.ts` and `pagination.constraints.ts` define
  bounded cursor queries and the `{ items, nextCursor }` response shape.
- `packages/i18n/messages/<locale>.json` holds UI and email copy. The generated
  runtime supplies supported locales; `routing.json` maps stable internal paths
  to public paths. Use `packages/i18n/src/routing.ts` for localized links and
  external callback URLs.

## Web hooks and UX

- `packages/ui/src/components` and `src/styles/globals.css` provide reusable
  primitives and tokens. Put feature-specific composites in their feature.
- `apps/web/src/lib/query/use-cursor-infinite-query.ts` handles cursor parameters
  while retaining native TanStack Query options. Include filters and page size
  in the caller's query key and forward abort signals.
- `apps/web/src/features/auth/queries/current-user.queries.ts` provides the
  identity query and fresh verification before entering protected routes.
- `apps/web/src/lib/query/private-cache.ts` cancels and removes private queries
  on identity transitions while preserving public queries. Build private query
  keys with `lib/query/query-keys.ts` so new features participate automatically.
- `apps/web/src/features/auth/form-context.ts` and `hooks/use-auth-form.ts`
  compose shared TanStack Form contexts. Reuse `AuthInput` and
  `AuthSubmitButton` for matching auth forms; keep navigation and form
  feedback in feature hooks. Auth write options in
  `features/auth/mutations/auth.mutations.ts` preserve provider results and clear
  private cache after successful identity writes.
- `apps/web/src/lib/api/client.ts` is the typed cookie-based HTTP client.
  Use `lib/auth/redirect.ts` for internal redirect validation.

## Server functions

- `apps/api-nestjs/src/infrastructure/pagination/cursor-page.ts` builds a cursor page
  from `limit + 1` rows. The query must use a matching unique order and cursor.
- `apps/api-nestjs/src/infrastructure/auth/guard.ts` supplies global session protection
  and the `Public` and `CurrentUser` decorators for Nest controllers.
- `apps/api-nestjs/src/infrastructure/rate-limit` supplies global quotas, per-route
  overrides and probe exemptions.
- `packages/core/src/email.ts` defines the framework-independent `EmailSender`
  port; `packages/email` renders localized HTML/text and provides transports.

Infrastructure setup, verification helpers and commands belong in
[DEVELOPMENT.md](DEVELOPMENT.md); boundaries and flows belong in
[ARCHITECTURE.md](ARCHITECTURE.md).
