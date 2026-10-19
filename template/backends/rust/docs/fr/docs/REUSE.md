# Réutilisation

- `packages/contracts/src/auth.constraints.ts` : limites frontend ; synchroniser `apps/api/src/settings.rs`.
- `apps/api/src/runtime.rs` : configuration et autorisation des migrations.
- `apps/api/src/quotas.rs` : admission atomique partagée et erreurs fermées.
- `apps/api/src/mail.rs` / `smtp.rs` : emails localisés et transport sécurisé.
- `apps/api/src/openapi.rs` et DTO : contrat HTTP applicatif.
- `apps/web/src/lib/api/client.ts` : client typé avec cookies.
- `apps/web/src/features/auth/queries/current-user.queries.ts` : identité fraîche.
- `apps/web/src/lib/query/private-cache.ts` : invalidation des données privées.
- `apps/web/src/lib/query/use-cursor-infinite-query.ts` : navigation par curseur.
- `packages/i18n/src/routing.ts` : liens localisés et callbacks.
- `packages/ui/src/components` : primitives d'interface.

Voir l'[architecture](ARCHITECTURE.md) et le [développement](DEVELOPMENT.md).
