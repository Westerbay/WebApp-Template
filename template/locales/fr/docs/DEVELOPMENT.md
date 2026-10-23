# Développement

## Démarrage local

Utiliser Node.js 24 et pnpm 12. Copier `.env.example` vers un `.env` local ;
ne jamais versionner ni partager le vrai fichier.

```bash
pnpm install --frozen-lockfile
pnpm dev:infra
pnpm db:migrate
pnpm dev
```

Les ports par défaut sont web 3000, API 3001 et PostgreSQL 5433.
`pnpm run setup` démarre l’infrastructure et applique les migrations protégées ;
il ne crée pas de données de test. `pnpm dev:down` arrête les services sans
supprimer le volume de la base.

Le `compose.yml` standard reste à la racine ; les stacks optionnelles et de test
sont dans `infra/compose/`. Les scripts d’infrastructure sont dans `scripts/infra/` ;
utiliser les commandes pnpm de la racine comme points d’entrée. Conserver `.mjs`
pour les fichiers structurés, l’orchestration des processus et le nettoyage des
ressources ; Bash convient aux courtes étapes de CI propres au shell.
`pnpm tooling:test` vérifie le lanceur optionnel sans Docker (son faux exécutable
POSIX est ignoré sous Windows). Les suites d’intégration, E2E et d’observabilité
nécessitent Docker et nettoient uniquement leurs propres ressources temporaires.

## Langues et chemins publics

Modifier `packages/i18n/messages/<locale>.json` pour les messages UI et email,
et `packages/i18n/routing.json` pour les chemins publics. Les langues supportées
et celle par défaut sont dans `packages/i18n/project.inlang/settings.json`.
Les routes internes et chemins API restent anglais. Reconstruire les types
générés après une modification des catalogues :

```bash
pnpm --filter @workspace/i18n build
```

## Contrôles et API générée

```bash
pnpm check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
pnpm project:check
pnpm boundaries:check
pnpm boundaries:test
pnpm test:integration
pnpm test:e2e
```

Les E2E écrivent les captures mobiles et résultats JUnit dans
`output/playwright/<locale>/`. Un échec navigateur enregistre aussi
`auth-failure.png` lorsque la page est disponible. Les exécutions E2E échouées
sur la CI téléversent les diagnostics disponibles sous `e2e-diagnostics`, conservés
sept jours ; les télécharger depuis les artefacts de l’exécution du workflow.

Les contrôles rapides ne nécessitent aucune base. L’intégration et les E2E
utilisent leurs propres infrastructures temporaires et nécessitent Docker ;
installer leur navigateur avec
`pnpm --filter @workspace/api exec playwright install chromium`.
`docs:check` valide les liens documentaires ; `project:check` vérifie les
frontières et la configuration. Son étape `boundaries:check` utilise
dependency-cruiser pour résoudre les imports avec les exports du workspace et
les alias TypeScript web. Construire d’abord les packages du workspace pour
rendre disponibles les exports générés ; `pnpm check` le fait via typecheck.
Le fichier d’outillage `scripts/tsconfig.boundaries.json` hérite des alias web
et fournit l’URL de base requise par le résolveur. Les imports source non résolus
font échouer le contrôle, sauf les ressources CSS URL de Vite. Exécuter
`boundaries:test` pour exercer les dépendances refusées et autorisées dans des
fixtures isolées. Après modification de contrôleurs ou DTO Nest, exécuter
`pnpm api:generate` et inclure le schéma API et les types du client web générés.
`pnpm api:check` vérifie les dérives sans base ni connexion SMTP.

## Sécurité et mises à jour des dépendances

Le [guide CI](CI.md) décrit les événements, la réutilisation des validations et
les statuts obligatoires. La [CI de sécurité](../.github/workflows/security.yml)
est appelée une seule fois par le workflow d’entrée pour les PR, pushs directs
sur main, lancements manuels et scans hebdomadaires. Elle analyse les secrets,
les dépendances JavaScript/Rust et une matrice d’images d’infrastructure uniques.
Les vulnérabilités HIGH/CRITICAL, même sans correctif, et les erreurs de service
du scanner bloquent. Aucun vrai fichier d’environnement ni base n’est nécessaire.
Rendre `CI checks` et `Security checks` obligatoires dans les règles de branche
pour imposer ces résultats.

La [configuration Renovate](../renovate.json) prépare des PR de mise à jour
hebdomadaires pour les dépendances du workspace, les images Compose et les GitHub
Actions. Installer l’[application GitHub Renovate](https://github.com/apps/renovate)
sur chaque dépôt utilisant le template pour activer les mises à jour. Les versions
mineures et correctives compatibles sont regroupées ; les versions majeures restent
séparées et la fusion reste manuelle. Les mises à jour de pnpm restent manuelles,
car la CI et les contrôles du projet verrouillent aussi sa version. Lors des mises
à jour Compose, aligner les références d’images présentes dans les scripts de test
JavaScript : Renovate ne modifie pas ces chaînes intégrées aux scripts.

Le workflow de sécurité et la configuration Renovate sont inclus dans les projets
générés. Pour reproduire l’audit localement, exécuter
`pnpm -r audit --audit-level high` après installation des dépendances. Le scan des
images nécessite un accès aux registres publics et à la base de vulnérabilités Trivy.

L’UI partagée importe les utilitaires extraits de shadcn 4.21.0 depuis
`packages/ui/src/styles/shadcn.css`, avec leur notice MIT. Le CLI shadcn n’est pas
une dépendance installée ; utiliser `pnpm dlx shadcn@latest` pour ajouter des
composants. Les évolutions amont de `shadcn/tailwind.css` doivent être examinées
et copiées explicitement.

## Données locales et email

Les commandes de migration et de données de test refusent staging, production
et les bases distantes ou non vérifiées. Activer le mode fixture localement
avant de lancer :

```bash
pnpm db:seed -- --scenario auth
pnpm db:seed -- --all
pnpm db:seed -- --scenario auth --clean
```

Le scénario auth fournit deux comptes de référence et 60 profils d’exemple.
Sa configuration est dans `apps/api/src/seeds/auth/fixtures.config.ts`.
Nettoyer les fixtures avec l’ancienne configuration avant de modifier leurs ID
ou leur nombre ; le nettoyage reconnaît uniquement ses propres enregistrements.
La migration initiale est une base auth uniquement et ne s’applique pas aux
bases issues d’un ancien historique de migrations.

Les emails de développement vont dans Mailpit sur SMTP 1025, avec une interface
sur `http://localhost:8025`. Le SMTP de production exige des identifiants, un
expéditeur et TLS explicites. Le SMTP de staging est activé explicitement et
utilise une liste exacte de destinataires autorisés. Les nouveaux mots de passe
sont vérifiés avec Have I Been Pwned uniquement en staging et production ;
autoriser le HTTPS sortant vers `api.pwnedpasswords.com` dans ces environnements.
Développement et tests restent hors ligne.

## Réutilisation de la pagination par curseur

Définir la réponse et la requête bornée dans `packages/contracts`, utiliser un
ordre stable unique et `limit + 1` lignes avec `createCursorPage` dans l’API,
puis régénérer OpenAPI. Dans le web, utiliser `useCursorInfiniteQuery`, inclure
taille de page et filtres dans la clé de requête, et transmettre le signal
d’annulation. La fonctionnalité utilisateurs est l’exemple fonctionnel.

## Observabilité et santé

Les logs de développement sont lisibles ; staging et production imposent du
JSON sur stdout. Les réponses portent `x-request-id`. Les logs HTTP omettent
en-têtes, corps, cookies, tokens et données personnelles. La liveness ne contacte
pas les dépendances ; la readiness vérifie PostgreSQL et Valkey s’il est activé.
Configurer la confiance proxy uniquement pour une chaîne de proxies vérifiée.

La stack d’observabilité optionnelle fournit quatre dashboards Grafana, des
logs Loki, des métriques Prometheus, une sonde de readiness et des règles
d’alerte initiales :

```bash
pnpm logs:up
pnpm dev:logs
pnpm logs:check
pnpm logs:test
pnpm logs:down
```

Voir [OBSERVABILITY.md](OBSERVABILITY.md) pour la démonstration autonome, l’accès
réseau aux métriques, le périmètre des dashboards, l’intégration en production
et les procédures d’alerte. Alloy intègre les exportateurs PostgreSQL et Valkey
indépendamment de l’API. Les statistiques SQL PostgreSQL sont activées par
défaut dans la stack d’observabilité. Les procédures d’installation et de
diagnostic sont dans [POSTGRESQL-PERFORMANCE.md](POSTGRESQL-PERFORMANCE.md).

## Quotas partagés optionnels

L’API de base ne nécessite pas Valkey. Démarrer son service local indépendant,
puis activer l’API avec `VALKEY_ENABLED=true` et une `VALKEY_URL` de boucle
locale. Garder `VALKEY_NAMESPACE` distinct par application et environnement,
et identique entre réplicas. Le service local est éphémère et sans
authentification ; un Valkey déployé nécessite un accès et une disponibilité
gérés par la plateforme.

```bash
pnpm valkey:up
pnpm valkey:test
pnpm valkey:down
```

Valkey activé est requis au démarrage et pour la readiness. Un échec de
contrôle de quota renvoie 503. Les limites Better Auth et sessions restent
dans PostgreSQL.

## Worktrees Git

```bash
pnpm worktree:create
pnpm worktree:remove
pnpm worktree:check
```

La création et la suppression acceptent un nom de branche interactivement ou
en argument. Les chemins sont dans le répertoire ignoré `.worktree/` du checkout
principal. La création utilise une branche locale existante ou en démarre une
nouvelle depuis le HEAD du checkout principal. La suppression doit être exécutée
hors du worktree cible et conserve sa branche ; Git refuse les worktrees modifiés
ou verrouillés. Les dépendances et fichiers d’environnement locaux ne sont pas
copiés dans un nouveau checkout.
