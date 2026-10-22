# Application web — API Rust

Frontend TanStack Start, React, Zod et Paraglide dans `apps/web` et `packages/i18n`.
L'API `apps/api` utilise Axum, Better Auth RS et PostgreSQL, entièrement en Rust.
Node 24 et pnpm 12 servent au frontend et aux outils de développement.

Installer Rust 1.90 avec rustfmt/Clippy, une chaîne C, les bibliothèques de développement
OpenSSL et Docker. Copier soi-même `.env.example` vers `.env`, remplacer le secret
par au moins 32 caractères aléatoires, puis :

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

Frontend : localhost:3000 ; Mailpit : localhost:8025. Redémarrer l'API après une
modification Rust ; Vite recharge le frontend. Lire le [développement](docs/DEVELOPMENT.md),
l'[architecture](docs/ARCHITECTURE.md) et les [règles produit](docs/PRODUCT.md).
Better Auth RS reste une dépendance alpha épinglée. Cette variante vise les nouveaux
projets ; elle ne migre pas les comptes Nest existants. Elle fournit des logs JSON
et des sondes de santé, sans les adaptateurs Valkey/Grafana de Nest.

Basé sur [WebApp Template](https://github.com/Westerbay/WebApp-Template), licence MIT.
