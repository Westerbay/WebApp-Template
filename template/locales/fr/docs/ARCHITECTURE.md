# Architecture

## Frontières

```text
apps/web → packages/contracts, packages/ui, packages/i18n, types API générés
apps/api → packages/contracts, packages/database, packages/email
packages/database → Drizzle ORM, PostgreSQL
packages/core → ports indépendants des frameworks
```

NestJS compose l’API ; Express monte Better Auth sous `/api/auth` avant le
parseur JSON de Nest. Better Auth possède les utilisateurs, comptes et sessions.
Nest protège ses contrôleurs avec une garde de session globale, sauf pour les
routes publiques. `packages/core` contient uniquement des ports indépendants
des technologies, actuellement `EmailSender`. Les contrats possèdent les schémas
de frontière ; database possède la persistance ; UI possède les primitives
réutilisables. Le web n’importe jamais de modules serveur.

`pnpm boundaries:check` impose ces directions de dépendance avec les
[règles de dépendances](../packages/config/dependency-cruiser.mjs), y compris
pour les imports de types, imports dynamiques et alias résolus. Les ports core
n’ont aucune dépendance externe ; les contrats dépendent uniquement de leurs
propres schémas et de Zod ; les primitives UI ne dépendent pas des packages
métier. Les packages partagés n’importent jamais les applications.

Les fichiers de routes auth sont dans `apps/web/src/routes/(auth)`. Les groupes
entre parenthèses organisent les fichiers sans ajouter de segment d’URL ni de
layout ; les chemins internes et localisés restent inchangés. Ajouter un layout
protégé sans chemin seulement lorsque plusieurs routes protégées nécessitent une
vérification de session ou une structure commune.

Les routes composent navigation, métadonnées et composants de fonctionnalités.
Chaque fonctionnalité possède son état serveur : `queries/` contient les clés,
lectures et options de requête réutilisables ; `mutations/` contient les écritures
et leurs effets sur le cache. `hooks/` possède les formulaires, la navigation et
les interactions d’écran, en consommant ces options avec TanStack Query.
Créer ces dossiers uniquement au besoin. Les clients et mécanismes génériques de
cache restent dans le `lib` web ; les requêtes métier restent dans leur fonctionnalité.
Better Auth renvoie les erreurs fournisseur dans ses résultats : les consommateurs
auth vérifient `result.error`. Seules les écritures d’identité réussies nettoient
le cache privé, avant la navigation. La route d’accueil compose
le résumé de compte auth et le tableau utilisateurs ; auth ne possède pas le
dashboard. Le header applicatif compose les actions de session auth. Les règles
de dépendances gardent chaque `features/<name>` indépendant des autres
fonctionnalités, des routes et des composants de structure applicative. Les
mécanismes partagés de `lib` ne dépendent ni des fonctionnalités ni de leur
composition. Ces règles couvrent les nouveaux dossiers sans ajouter leurs noms
à la configuration. Composer les fonctionnalités dans les routes ou la structure
applicative ; extraire un mécanisme partagé uniquement pour un besoin commun
concret. Les configurations restent avec le module qui les applique. Les flux
auth et utilisateurs existants ne nécessitent aucune couche supplémentaire de
repository ou de port.

Les `modules/<name>` de l’API sont indépendants les uns des autres.
L’infrastructure et la configuration n’importent jamais les modules applicatifs ;
aucun de ces dossiers n’importe les points de composition du runtime ou d’OpenAPI.
`app.ts`, `bootstrap.ts` et `openapi/` composent leurs dépendances. Les contrôles
couvrent automatiquement les nouveaux noms de modules, tout en autorisant le
code local au module, l’infrastructure partagée et les adaptateurs de persistance.

## Flux des requêtes et de l’identité

Zod valide les entrées Nest et sérialise les réponses. Les erreurs Nest utilisent
une enveloppe stable et un identifiant de requête ; Better Auth conserve ses
propres réponses. OpenAPI est généré depuis les contrôleurs Nest avec des
providers inertes et produit les types du client web sans connexion à une base
ni à SMTP. Les deux clients API envoient les cookies de session. Le web lit
l’URL de l’API via `lib/api/config.ts`.

Avant la mise en cache par TanStack Query, les queries identité et utilisateurs
valident les réponses réussies via `lib/api/contracts.ts`. Ce point d’entrée
réutilise les schémas de `packages/contracts` pour Nest ; les projets Rust y
exposent les schémas Zod générés par Orval depuis OpenAPI Rust. `openapi-fetch`
reste le client HTTP typé. Les erreurs HTTP conservent leur traitement existant,
y compris les redirections d’authentification.

L’adaptateur HTTP Better Auth dérive les modèles de route de télémétrie depuis
les métadonnées des endpoints configurés, avec le moteur de routage Better Auth.
Il enregistre uniquement le modèle reconnu sur la requête ; les logs et métriques
partagent ce modèle. Les routes Nest utilisent automatiquement les métadonnées
Express. Aucun de ces chemins ne nécessite une liste parallèle d’endpoints.

L’entrée dans une route protégée vérifie `/api/me` avec des données fraîches.
Les transitions auth annulent et retirent les requêtes privées en préservant
les publiques. La réponse de l’utilisateur courant expose uniquement ID, nom,
email et statut de vérification. Les cibles de redirection internes sont
validées avant la navigation.

Better Auth vérifie les nouveaux mots de passe avec Have I Been Pwned en staging
et production ; développement et tests restent hors ligne. Un échec du service
refuse l’enregistrement du mot de passe. Une vérification refusée ou échouée lors
d’une réinitialisation consomme son lien : l’utilisateur doit en demander un
autre. Better Auth possède ses limitations de débit dans PostgreSQL. Les quotas
Nest par défaut sont locaux au processus et utilisent le pair de la socket ;
les sondes sont exemptées. Valkey peut partager les quotas Nest entre réplicas.
Un échec de contrôle partagé activé renvoie 503 au lieu de revenir silencieusement
à des compteurs locaux.

## Utilisateurs d’exemple et pagination

`/api/users` exige une session vérifiée. Son schéma de requête borne la taille
de page, le curseur et la recherche facultative sur nom ou email. Drizzle utilise
un ordre d’ID unique, le prédicat de curseur correspondant et `limit + 1` lignes.
Le constructeur de page partagé renvoie `{ items, nextCursor }`. La recherche
utilise une correspondance paramétrée insensible à la casse et traite les
caractères joker littéralement.

Le hook web enveloppe `useInfiniteQuery` ; les clés de requête incluent la taille
de page et la recherche appliquée. La fonctionnalité d’exemple possède le délai
de recherche, la navigation en cache, la nouvelle tentative et le rendu du tableau.
Un changement de recherche réinitialise la navigation. Ce contrat de curseur
n’implique ni nombre total ni accès aléatoire aux pages.

## Localisation et email

Paraglide compile les catalogues actifs et chemins publics localisés depuis
`packages/i18n`. Les identifiants de code et routes internes restent anglais.
Un projet monolingue n’a pas de préfixe de langue ; un projet multilingue préfixe
chaque route publique. TanStack Router réécrit les URL, tandis que le middleware
serveur isole l’état de langue SSR. Les chemins API restent inchangés.

Les liens utilisent les chemins internes ; les callbacks auth dérivent leur URL
publique de la langue courante. L’API accepte la langue d’un callback uniquement
depuis son origine web configurée et revient sinon à la langue par défaut.
Les emails produisent du HTML et du texte localisés. Le développement utilise
Mailpit ; la production exige une configuration SMTP explicite, et le SMTP de
staging utilise une liste exacte de destinataires autorisés.

## Exploitation et intégrations optionnelles

Pino émet des logs HTTP assainis avec identifiants de requête. La readiness
vérifie PostgreSQL et Valkey s’il est activé ; l’arrêt attend la fin des envois
email et ferme les ressources. Les CLI de migration et de données de test
refusent les bases distantes ou non vérifiées avant de se connecter.

Le point d’entrée du processus installe les gestionnaires de signaux d’arrêt
après le démarrage de l’API par `bootstrap.ts`. Le démarrage valide la
configuration avant d’acquérir des ressources et utilise le même nettoyage
idempotent en cas d’échec que lors d’un arrêt normal : arrêter HTTP, terminer
les envois email, fermer le serveur et le registre de métriques, puis Valkey et
PostgreSQL. Chaque fermeture restante est tentée si une autre échoue ; les
erreurs de démarrage et de nettoyage restent disponibles ensemble si les deux
échouent. Nest lève les erreurs de création au lieu de terminer le processus
avant que le nettoyage puisse s’exécuter.

La stack d’observabilité optionnelle transmet le JSON assaini via Alloy à Loki
et expose les métriques du processus, HTTP et email sur un serveur HTTP privé
séparé, activé explicitement pour Prometheus. Une sonde Blackbox vérifie la
readiness hors du processus API. Grafana provisionne quatre dashboards ;
Prometheus évalue des règles d’alerte initiales. Alloy intègre les exportateurs
amont PostgreSQL et Redis/Valkey. La collecte des dépendances est en lecture
seule et indépendante des processus API ; ses échecs n’affectent pas les
requêtes. Les identités de service, d’environnement et d’instance sont indexées ;
les identifiants de requête et d’utilisateur ne deviennent jamais des labels
de métriques ou d’index.

La collecte de charge SQL est activée par défaut dans la stack d’observabilité.
Un exportateur PostgreSQL séparé exécute des requêtes d’agrégation bornées avec
`pg_stat_statements(false)`, limitées à sa base et à son rôle configurés. Le
texte SQL et les identifiants de requête restent hors de la télémétrie. La
plateforme installe et précharge l’extension ; les migrations applicatives ne
le font pas. La collecte d’infrastructure ne nécessite aucun observateur
applicatif ni port de provider.

Un collecteur Docker séparé transmet les logs des conteneurs API de staging ou
de production explicitement sélectionnés vers un Loki géré en externe. La
plateforme possède le stockage déployé, l’accès, les sondes et l’acheminement
des notifications. Voir [OBSERVABILITY.md](OBSERVABILITY.md) pour l’exploitation.

Valkey est activé explicitement et contient uniquement les compteurs de fenêtre
glissante Nest. Il ne stocke ni sessions ni données applicatives. Son service
Compose local est éphémère et limité à la boucle locale ; l’accès et la
disponibilité en environnement déployé relèvent de la plateforme. Voir
[DEVELOPMENT.md](DEVELOPMENT.md) pour l’installation et les commandes de validation.
