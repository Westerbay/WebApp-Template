# Exploitation

L'API Rust écrit des logs JSON nettoyés sur stderr : route bornée, statut, durée et
identifiant généré, également retourné dans `x-request-id`. Aucune URL brute, query,
adresse email, en-tête, mot de passe, cookie ou jeton d'action n'est journalisé.
Les logs amont sont exclus ; les erreurs SMTP/quota portent des codes statiques.
Une erreur du processus donne un code de sortie non nul.

`/health/live` indique la disponibilité du processus ; `/health/ready` vérifie
PostgreSQL avec délai maximal et retourne 503 en cas d'échec. Ces routes publiques
sont exemptes des quotas. `webapp-api --health-check` interroge la disponibilité en
loopback pour Docker. L'arrêt ferme HTTP, attend les emails et tente la fermeture
SQL même si une autre opération de nettoyage échoue.

Pas de listener Prometheus Nest ni de dashboards Valkey/Grafana dans cette variante.
La plateforme collecte stderr et gère sondes HTTPS externes, alertes et rétention.
L'envoi SMTP n'est pas durable après crash ; l'acceptation ne garantit pas la livraison.
Une panne HIBP ou SQL ne contourne jamais les contrôles sensibles.
