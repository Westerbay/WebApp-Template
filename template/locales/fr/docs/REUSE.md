# Réutilisation

Utiliser cette carte lorsqu’une fonctionnalité nécessite une capacité partagée
existante. N’y ajouter un élément que s’il a un consommateur plausible au-delà
de son usage initial et un propriétaire stable. Garder les détails et outils
de test propres à une fonctionnalité avec celle-ci.

## Contrats et localisation

- `packages/contracts/src/auth.constraints.ts` possède les limites de mot de passe et durées des tokens utilisées par la validation, la configuration auth et le rendu email.
- `packages/contracts/src/pagination.ts` et `pagination.constraints.ts` définissent les requêtes à curseur bornées et la réponse `{ items, nextCursor }`.
- `packages/contracts/src/pagination.types.ts` possède le type générique `CursorPage` partagé avec la pagination frontend.
- `packages/i18n/messages/<locale>.json` contient les messages UI et email. Le runtime généré fournit les langues supportées ; `routing.json` associe les chemins internes stables aux chemins publics. Utiliser `packages/i18n/src/routing.ts` pour les liens localisés et les URL de callback externes.

## Hooks web et UX

- `packages/ui/src/components` et `src/styles/globals.css` fournissent les primitives UI et tokens réutilisables. Garder les compositions propres à une fonctionnalité avec celle-ci.
- `apps/web/src/lib/query/use-cursor-infinite-query.ts` gère les paramètres de curseur en préservant les options natives de TanStack Query. Inclure filtres et taille de page dans la clé du consommateur, et transmettre le signal d’annulation.
- `apps/web/src/features/auth/queries/current-user.queries.ts` fournit la requête d’identité et sa vérification fraîche avant une route protégée.
- `apps/web/src/lib/query/private-cache.ts` annule et retire les requêtes privées lors des transitions d’identité, en conservant les publiques. Construire les clés privées avec `lib/query/query-keys.ts` pour inclure automatiquement les nouvelles fonctionnalités.
- `apps/web/src/features/auth/form-context.ts` et `hooks/use-auth-form.ts` composent les contextes TanStack Form partagés. Réutiliser `AuthInput` et `AuthSubmitButton` pour les formulaires auth correspondants ; garder la navigation et les retours de formulaire dans les hooks de fonctionnalité. Les options d’écriture dans `features/auth/mutations/auth.mutations.ts` préservent les résultats fournisseur et nettoient le cache privé après une écriture d’identité réussie.
- `apps/web/src/lib/api/client.ts` est le client HTTP typé utilisant les cookies. Utiliser `lib/auth/redirect.ts` pour valider les redirections internes.
- `apps/web/src/lib/api/contracts.ts` expose les validateurs de réponse et types d’identité utilisés par les queries, selon le backend sélectionné.

## Fonctions serveur

- `apps/api/src/infrastructure/pagination/cursor-page.ts` construit une page à curseur depuis `limit + 1` lignes. La requête doit utiliser un ordre unique stable et le curseur correspondant.
- `apps/api/src/infrastructure/auth/guard.ts` fournit la protection globale par session et les décorateurs `Public` et `CurrentUser` pour les contrôleurs Nest.
- `apps/api/src/infrastructure/rate-limit` fournit les quotas globaux, leurs réglages par route et l’exemption des sondes.
- `packages/core/src/email.ts` définit le port `EmailSender` indépendant des frameworks ; `packages/email` produit le HTML et texte localisés et fournit les transports.

L’installation d’infrastructure, les outils de vérification et les commandes
appartiennent à [DEVELOPMENT.md](DEVELOPMENT.md) ; les frontières et flux
appartiennent à [ARCHITECTURE.md](ARCHITECTURE.md).
