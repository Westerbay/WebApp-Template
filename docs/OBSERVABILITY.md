# Observability

The optional local stack provides Grafana dashboards, Loki logs, Prometheus
metrics, a Blackbox HTTP readiness probe and Prometheus alert rules. It is a
development environment and a versioned integration example. A production
platform must supply private access, durable storage and notification routing.

## Local use

```bash
pnpm logs:up
pnpm dev:logs
```

Open [Grafana](http://localhost:3002/d/webapp-template-api-overview). The four dashboards
are provisioned from `infra/observability/grafana/dashboards` and edited in Git.
They link to one another and share environment, service and instance filters.
The routes dashboard adds route/method/status filters and a literal request-ID
search. Deployment annotations use `api.started` logs and their version.

`dev:logs` starts the application with a JSON mirror at `output/logs/api.jsonl`
and enables the separate metrics listener. For Docker to reach the host,
this command defaults `METRICS_HOST` to `0.0.0.0`; restrict its access with the
host firewall or set a specific interface reachable by the collector. The normal
API startup leaves metrics disabled, and the listener's default host is
`127.0.0.1`. Grafana, Prometheus, Loki and Alloy's published UI ports bind to
loopback. Blackbox has no published port.

Grafana allows anonymous viewing locally and disables the login form. Logs and
metrics use seven-day local retention. The development JSON mirror has no
automatic rotation. Stop the stack without deleting its data with:

```bash
pnpm logs:down
```

For a self-contained demonstration without a local `.env` or existing database:

```bash
pnpm logs:preview
```

This runs the integration fixture, prints a Grafana URL on a random loopback
port and keeps generating sample traffic. Ctrl+C stops the fixture and removes
only its owned containers, volumes and temporary files. Fixture auth HTTP
responses are simulated; PostgreSQL, Valkey, collectors, storage and probes are
real. It never seeds an application database.

## What the dashboards measure

| Dashboard           | Purpose                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API overview        | Scrape health, readiness probe, application traffic, 5xx ratio, successful p50/p95/p99, failed-request latency, in-flight work and deployed versions.                                                                             |
| API routes and logs | HTTP outcomes, 401/403/429 trends, busiest/failing/slowest normalized routes, structured errors and request-ID correlation.                                                                                                       |
| API infrastructure  | Node.js CPU, RSS/heap, event-loop delay, garbage collection, process uptime, observed restarts, dependency observations, PostgreSQL connections and SQL workload, Valkey resources, monitoring-service scrapes and firing alerts. |
| API auth and email  | Better Auth HTTP outcomes and quota blocks, email transport outcomes/duration and sanitized provider/failure events.                                                                                                              |

Health endpoints are excluded from application traffic/error/latency graphs and
alerts. Successful, client-error and server-error durations are separate.
Histogram percentiles are estimates. No traffic has no defined error ratio;
missing samples remain **No data/Unknown**, rather than implying success.

Routes come from framework templates. The Better Auth HTTP adapter derives its
route matcher from the configured API endpoint metadata, including plugin paths,
HTTP methods and parameter templates such as `/reset-password/:token`. It uses
the same routing engine as Better Auth; adding a controller endpoint or auth
plugin requires no observability route list or extra decorator. Disabled and
server-only auth endpoints are excluded. Unknown paths become `unmatched` or
`/api/auth/*`. No URL parameters, request IDs, emails or user IDs become
metric labels. Logs include sanitized request metadata and request IDs; headers,
bodies, cookies, query strings and reset tokens are excluded. Only service,
environment and instance identity are indexed in Loki.

Email **accepted** means the configured transport accepted the message, not that
it reached an inbox. HTTP auth outcomes do not establish unique users or business
conversion. Development may use the in-memory email transport.

Alloy's embedded upstream PostgreSQL and Redis/Valkey exporters collect dependency
metrics independently of the API. Prometheus scrapes their private endpoints.
PostgreSQL custom queries export fixed aggregates scoped to the configured database
and role, with server-wide connection capacity. The DSN sets a 1.5-second statement
timeout, read-only sessions and a two-second connection timeout. Valkey collection
uses the exporter's two-second connection timeout; key scans and values are disabled.
API-instance filters apply only to API process signals, not shared infrastructure.
Valkey's dependency alert is gated by the API's enabled flag. Exporter scrape
failures are surfaced separately from API readiness; missing data is not success.

A separate PostgreSQL exporter collects `pg_stat_statements` aggregates by default.
Its failures do not hide basic PostgreSQL observations. Development Compose sets
up fresh databases automatically; deployed databases require administrator setup.
See [POSTGRESQL-PERFORMANCE.md](POSTGRESQL-PERFORMANCE.md) for activation, scope,
reset/eviction semantics and temporary `auto_explain` use.

Node.js metrics concern the API process, not the whole host. Restart detection
needs a stable instance identity and samples on both sides of the restart; container
replacement counters, host disk/network metrics, database query traces and end-user
browser measurements require platform exporters or additional instrumentation.

## Configuration and production integration

The API owns validation in
`apps/api-nestjs/src/infrastructure/observability/observability.config.ts`:

- `METRICS_ENABLED=true` enables metrics on a separate HTTP listener.
- `METRICS_HOST` selects its private interface; default `127.0.0.1`.
- `METRICS_PORT` defaults to `9464`.
- `APP_VERSION` is a bounded release identifier, such as a Git SHA; default `unknown`.

Infrastructure collection is configured in `infra/observability/config.alloy`,
with aggregate SQL in `postgres.yml` and `postgres-statements.yml`. Local Compose
accepts `OBS_POSTGRES_DSN` and `OBS_VALKEY_URL`; its defaults match `.env.example`
and target host services through `host.docker.internal`. Export these variables
in the shell when using different targets. `logs:up` does not load a real `.env`.
Loopback-only Valkey may require a private Docker network or a reachable interface
for the collector; do not expose it publicly. The isolated test uses container DNS.

Production should configure one collector per database/role and Valkey instance,
with credentials supplied by the platform's secret mechanism. Preserve read-only
SQL and timeout options, and use verified TLS for remote PostgreSQL targets.
The local DSN disables TLS only for the development container. Do not give the API additional monitoring privileges.
Remove the statements scrape job to opt out of SQL statistics; remove the Valkey
scrape job when Valkey is unused. Alloy already includes both exporters, so no
additional container images or application packages are required. Exporter endpoints
and Alloy's diagnostic UI must remain private. The supplied Compose is local only.

Only `GET /metrics` is served on that listener. It does not share the public API
router or session authentication. Keep it on a private network/interface and use
platform network access controls or an authenticated scrape proxy when needed.
Never expose the local anonymous Grafana/Loki/Prometheus stack publicly.

The local scrape/probe targets in
`infra/observability/prometheus/prometheus.yml` assume host API port 3001 and
metrics port 9464. Adjust them when using other ports. Use one scrape target per
API replica with labels matching its actual environment/service. Application
samples also carry `instance_id`, shared with their logs. Configure a stable
hostname/instance identity, unique per concurrent replica. Probes represent the
service endpoint and apply to all instances; API-instance filters do not narrow
service availability.

In production, provision the dashboards against Loki and Prometheus-compatible
data sources with UIDs `loki` and `prometheus`. Scrape each API instance privately.
The Docker collector in `infra/compose/logs-collector.yml` sends opted-in containers'
JSON stdout to an externally managed Loki backend. It needs `APP_ENV=staging|production`
and the full `LOKI_URL`; token-file and tenant settings are optional. Containers
need `webapp-template.logs=true` and matching `webapp-template.logs.environment` labels. Read-only
Docker-socket access still gives broad host privileges and requires a trusted platform.

Run a probe outside the API process against the deployed service URL. The local
Docker probe proves local reachability/readiness only; an independent monitoring
location is needed to measure public DNS/TLS/network availability. Configure
secure platform access, retention/backups and notification routing separately.
Traces and real delivery confirmation are not supplied by this integration.

## Alert rules and runbooks

Rules live in `infra/observability/prometheus/rules.yml`. Their thresholds are
starter values, not an established service-level objective. Adjust them using
expected traffic and agreed availability/latency goals. Traffic gates suppress
ratio alerts when sample counts are too small. Probe and scrape alerts still
operate without application traffic.

Prometheus evaluates the rules and the infrastructure dashboard shows firing
conditions. No notification destination is configured. Production must route
alerts through its Alertmanager/Grafana setup, test delivery, replace the local
`dashboard_url` annotations and link these runbooks from its documentation.

### PostgresQueryStatisticsUnavailable

SQL statistics collection has failed for two minutes while enabled. Check `pg_stat_statements` installation in `public`, server preload,
the collector role's read permissions and query timeout. PostgreSQL readiness
is independent of this warning. Follow
[POSTGRESQL-PERFORMANCE.md](POSTGRESQL-PERFORMANCE.md) for setup; do not reset
statistics or grant broad monitoring privileges to clear the alert.

### ApiUnavailable

Readiness or its probe scrape fails for two minutes. Check probe reachability,
API logs, the latest deployment and PostgreSQL/enabled Valkey. Compare liveness
and readiness to distinguish process reachability from dependency failure.

### ApiMetricsMissing

A scrape fails or the API scrape job is absent for three minutes. Check the
metrics listener, private network, configured target and Prometheus targets page.
Do not infer zero errors from missing samples.

### ApiHighServerErrorRate

5xx exceed 5% for five minutes, with at least 30 requests per five-minute window.
Open failing routes and filter logs by request ID. Check deployment annotations,
dependency observations and response validation errors.

### ApiSlowRequests

Successful-request p95 exceeds one second for ten minutes, with the same traffic
gate. Inspect slow routes, event-loop delay, CPU and dependency observations.
Observation latency is a diagnostic hint, not a business-query profile.

### ApiDependencyUnavailable

An enabled dependency observation fails for two minutes. Check availability,
network access and observation permissions (`pg_stat_activity`/Valkey `INFO`).
Inspect readiness separately; a monitoring permission failure can occur while
business requests still succeed.

### PostgresConnectionPressure

Server connections exceed 80% of configured capacity for ten minutes. Inspect
replica/pool counts, active work and lock waiting. Use one collector per server/role to avoid duplicate observations.

### ValkeyMemoryPressure

Memory exceeds 80% of a positive configured limit for ten minutes. Inspect quota
traffic, namespace growth and server events. A zero limit means unlimited and
cannot provide a capacity percentage.

### ApiEventLoopDelay

Event-loop p99 delay exceeds 100 ms for ten minutes. Correlate with process CPU,
garbage collection and successful-request latency. Investigate synchronous work
before changing resource limits.

### AuthEmailFailures

Failures exceed 10% for five minutes, with at least five transport outcomes per
ten-minute window. Check email provider connectivity, sender/recipient policy and safe
failure logs. Do not assume retry or inbox-delivery guarantees.

### ObservabilityCollectorUnavailable

Loki, Alloy or Blackbox cannot be scraped for three minutes. Check the affected
service's health and logs before interpreting missing application observations.

## Validation

```bash
pnpm logs:check
pnpm logs:test
pnpm logs:test:docker
```

All require Docker. `logs:check` uses the pinned Prometheus image to validate
configuration and test alert duration, traffic gates, missing metrics, probe
exclusion and optional Valkey behavior. `logs:test` uses owned temporary services
to exercise real Nest HTTP logging, email outcomes, PostgreSQL/Valkey observations,
external readiness and every dashboard panel query through Grafana. The Docker
collector test verifies opt-in/environment isolation against local Loki.

Validate the deployed collector fragment without contacting a remote backend:

```bash
APP_ENV=staging LOKI_URL=https://logs.example.invalid/loki/api/v1/push \
  docker compose --env-file /dev/null -f infra/compose/logs-collector.yml config --quiet
```
