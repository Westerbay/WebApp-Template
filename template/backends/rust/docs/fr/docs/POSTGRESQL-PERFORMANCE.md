# PostgreSQL

L'API utilise un pool SeaORM/SQLx borné, des index pour utilisateurs/sessions/comptes,
une pagination par curseur et une table de quotas indexée. Les quotas atomiques
consomment PostgreSQL : dimensionner la base avec les réplicas API.
Le Compose local précharge `pg_stat_statements` via le
[script d'initialisation local](../infra/postgres/query-statistics.sql).
Un volume existant ne rejoue pas cette initialisation. La plateforme possède les
extensions de production, leur préchargement et les rôles de diagnostic en lecture
seule ; les migrations applicatives n'installent aucune extension. Ne pas exporter
de SQL brut, secrets ou données personnelles dans la télémétrie.
