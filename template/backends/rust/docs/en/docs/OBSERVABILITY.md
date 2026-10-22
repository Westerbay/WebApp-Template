# Operations

The Rust API writes sanitized structured JSON to stderr, with bounded route names,
HTTP status, duration and generated request IDs. Responses include `x-request-id`.
Raw URLs, queries, headers, email addresses, passwords, cookies and action tokens
are not logged. Upstream auth logs are excluded because they may contain secrets.
SMTP/quota failures use static event codes; process failures return a nonzero exit.

`/health/live` reports process availability. `/health/ready` checks PostgreSQL with
a timeout and returns 503 on failure. Both are public and exempt from quotas.
`webapp-api --health-check` checks readiness over loopback for the Docker health
check. Shutdown stops HTTP, drains SMTP work and attempts database closure even
when another cleanup operation fails.

This variant does not expose the Nest Prometheus metrics listener or include its
Valkey/Grafana dashboards. Forward JSON stderr to the platform collector and
configure external HTTPS readiness probes, retention, alerts and access controls.
SMTP has no durable queue; accepted requests do not promise delivery after a crash.
HIBP or quota-storage outages reject sensitive writes instead of bypassing checks.
