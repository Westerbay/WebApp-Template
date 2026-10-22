# Contexte

Frontend TanStack, API Rust Axum, identité Better Auth RS, persistance PostgreSQL.
L'application propose une auth email/mot de passe vérifiée et une liste d'utilisateurs
recherchable avec pagination par curseur. Voir le [produit](PRODUCT.md),
l'[architecture](ARCHITECTURE.md), la [réutilisation](REUSE.md), le [design](DESIGN.md),
le [développement](DEVELOPMENT.md), l'[exploitation](OBSERVABILITY.md) et
[PostgreSQL](POSTGRESQL-PERFORMANCE.md).

Better Auth RS est une dépendance alpha épinglée. Aucun serveur Node, migration de
comptes existants, OAuth, MFA ou file d'emails durable n'est fourni. Les quotas
partagés PostgreSQL échouent de façon fermée. La plateforme possède le TLS,
les sauvegardes, le déploiement et la supervision de production.
