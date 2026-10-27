# Réutilisation

- `packages/contracts/src/auth.constraints.ts` : limites frontend ; synchroniser `apps/api/src/config/auth.rs`.
- `apps/api/src/config/runtime.rs` : configuration et autorisation des migrations.
- `apps/api/src/infrastructure/rate_limit/store.rs` : admission atomique partagée et erreurs fermées.
- `apps/api/src/infrastructure/email/mail.rs` / `infrastructure/email/smtp.rs` : emails localisés et transport sécurisé.
- `apps/api/src/openapi/mod.rs` et DTO : contrat HTTP applicatif.
- `apps/web/src/lib/api/client.ts` : client typé avec cookies.
- `apps/web/src/lib/api/contracts.ts` : validateurs de réponse et types d’identité générés ; régénérer avec `pnpm api:generate` après modification des DTO Rust.
- `packages/contracts/src/pagination.types.ts` : type générique de page à curseur.
- `apps/web/src/features/auth/queries/current-user.queries.ts` : identité fraîche.
- `apps/web/src/lib/query/private-cache.ts` : invalidation des données privées.
- `apps/web/src/lib/query/use-cursor-infinite-query.ts` : navigation par curseur.
- `packages/i18n/src/routing.ts` : liens localisés et callbacks.
- `packages/ui/src/components` : primitives d'interface.

Voir l'[architecture](ARCHITECTURE.md) et le [développement](DEVELOPMENT.md).
