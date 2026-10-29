import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readdir, readFile } from "node:fs/promises"
import { createDatabase } from "../../packages/database/dist/index.js"
import { MemoryEmailSender } from "../../packages/email/dist/index.js"
import { DEFAULT_LOCALE } from "../../packages/i18n/src/config.ts"
import { createApiApp } from "../../apps/api-nestjs/dist/app.js"
import { createApiLogger } from "../../apps/api-nestjs/dist/infrastructure/logging/logging.js"
import { createApiMetrics } from "../../apps/api-nestjs/dist/infrastructure/observability/metrics.js"
import { startMetricsServer } from "../../apps/api-nestjs/dist/infrastructure/observability/server.js"
import { createValkey } from "../../apps/api-nestjs/dist/infrastructure/valkey/valkey.js"
import { AuthEmailDispatcher } from "../../apps/api-nestjs/dist/infrastructure/email/auth-email-dispatcher.js"
import {
  createLogsTestHarness,
  logsTestConfig,
  waitFor,
} from "./support/logs-test-harness.mjs"

const require = createRequire(
  new URL("../../apps/api-nestjs/package.json", import.meta.url)
)
const { Router } = require("express")

const harness = await createLogsTestHarness()
const preview = process.argv.includes("--preview")
let app, metricsServer, database, valkey, trafficTimer
const metrics = createApiMetrics("development", "observability-fixture", {
  valkey: true,
})
try {
  const logger = createApiLogger("development", undefined, {
    format: "json",
    file: harness.directory + "/api.jsonl",
    version: "observability-fixture",
  })
  logger.info({ event: "api.started" })
  let failSession = false
  let authStatus = 200
  const authHandler = Router()
  authHandler.post("/sign-in/email", (_request, response) =>
    response.sendStatus(authStatus)
  )
  const getSession = async () => {
    if (failSession) throw new Error("private-session-secret")
    return {
      user: {
        id: "fixture-user",
        name: "Fixture",
        email: "fixture@example.test",
        emailVerified: true,
      },
      session: { id: "fixture-session" },
    }
  }
  const databaseReady = async () => {
    if (!database || !valkey)
      throw new Error("Fixture dependencies are not connected")
    await Promise.all([database.ready(), valkey.ready()])
  }
  app = await createApiApp({
    logger,
    metrics,
    authHandler,
    getSession,
    databaseReady,
    listUsers: async () => ({ items: [], nextCursor: null }),
  })
  await app.listen(0, "0.0.0.0")
  const address = app.getHttpServer().address()
  assert.ok(address && typeof address !== "string")
  const api = "http://127.0.0.1:" + address.port
  metricsServer = await startMetricsServer(metrics, {
    host: "0.0.0.0",
    port: 0,
  })
  const metricsAddress = metricsServer.server.address()
  assert.ok(metricsAddress && typeof metricsAddress !== "string")
  await harness.configureMetrics(address.port, metricsAddress.port)
  harness.start()
  const pgAddress = new URL(harness.getServiceUrl("postgres", 5432)).host
  database = createDatabase(
    `postgresql://webapp_template_auth_test:isolated-fixture-only@${pgAddress}/webapp_template_auth_test`
  )
  valkey = createValkey(
    harness.getServiceUrl("valkey", 6379).replace("http:", "redis:"),
    () => {}
  )
  await valkey.client.connect()
  const loki = harness.getServiceUrl("loki", logsTestConfig.lokiPort)
  const grafana = harness.getServiceUrl("grafana", logsTestConfig.grafanaPort)
  const prometheus = harness.getServiceUrl(
    "prometheus",
    logsTestConfig.prometheusPort
  )
  await waitFor(async () => {
    assert.equal((await fetch(loki + "/ready")).status, 200)
    assert.equal((await fetch(grafana + "/api/health")).status, 200)
    assert.equal((await fetch(prometheus + "/-/ready")).status, 200)
    await databaseReady()
  })
  // Exercise the rebuilt core Loki component and the signed Prometheus plugin.
  for (const [id, signature] of [
    ["loki", "internal"],
    ["prometheus", "valid"],
  ]) {
    const settings = await fetch(`${grafana}/api/plugins/${id}/settings`)
    assert.equal(settings.status, 200)
    assert.equal((await settings.json()).signature, signature)
    assert.equal(
      (await fetch(`${grafana}/public/plugins/${id}/module.js`)).status,
      200
    )
  }
  // Image builds can exceed the Loki query window; emit the probe once ready.
  logger.debug({ event: "logs.debug_probe" })
  harness.executePostgres("SELECT 'private-sql-literal'::text")
  const response = await fetch(
    api + "/health/live?token=private-query-secret",
    {
      headers: { Authorization: "Bearer private-header-secret" },
    }
  )
  assert.equal(response.status, 200)
  const requestId = response.headers.get("x-request-id")
  assert.ok(requestId)
  for (let i = 0; i < 8; i++) {
    assert.equal((await fetch(api + "/api/me")).status, 200)
    assert.equal((await fetch(api + "/api/users")).status, 200)
  }
  for (const status of [200, 401, 403, 429, 500]) {
    authStatus = status
    await fetch(api + "/api/auth/sign-in/email", { method: "POST" })
  }
  authStatus = 200
  await fetch(api + "/not-a-route/42")
  failSession = true
  const failure = await fetch(api + "/api/me")
  assert.equal(failure.status, 500)
  const failureId = failure.headers.get("x-request-id")
  failSession = false
  const reportEmail = (event) => {
    metrics.recordEmail(event)
    if (event.event === "email.accepted") logger.info(event)
    else logger.error(event)
  }
  const successEmail = new AuthEmailDispatcher(
    new MemoryEmailSender(),
    reportEmail
  )
  const failedEmail = new AuthEmailDispatcher(
    {
      send: async () => {
        throw new Error("private-smtp-secret")
      },
    },
    reportEmail
  )
  const email = {
    kind: "verification",
    to: "fixture@example.test",
    url: "http://localhost/?token=private-email-token",
    locale: DEFAULT_LOCALE,
    requestId: failureId,
  }
  successEmail.enqueue(email)
  failedEmail.enqueue({ ...email, kind: "reset" })
  await Promise.all([successEmail.close(), failedEmail.close()])

  const query = '{service_name="webapp-template-api",environment="development"}'
  const result = await waitFor(async () => {
    const response = await fetch(
      loki +
        "/loki/api/v1/query_range?" +
        new URLSearchParams({
          query,
          since: logsTestConfig.queryWindow,
          limit: logsTestConfig.queryLimit,
        })
    )
    assert.equal(response.status, 200)
    const payload = await response.json()
    const lines = payload.data.result.flatMap((stream) =>
      stream.values.map(([, line]) => JSON.parse(line))
    )
    assert.ok(lines.some((line) => line.request?.requestId === requestId))
    assert.ok(
      lines.some(
        (line) =>
          line.request?.requestId === failureId && line.response?.status === 500
      )
    )
    assert.ok(lines.some((line) => line.event === "email.failed"))
    assert.ok(lines.some((line) => line.event === "logs.debug_probe"))
    return lines
  })
  const requestLines = result.filter(
    (line) => line.request?.requestId === requestId && line.response
  )
  assert.equal(requestLines.length, 1, "HTTP logs must not be duplicated")
  assert.equal(requestLines[0].request.path, "/health/live")
  assert.equal(requestLines[0].response.status, 200)
  assert.equal(typeof requestLines[0].durationMs, "number")
  assert.ok(
    result.some(
      (line) => line.route === "/api/me" && line.response?.status === 500
    )
  )
  assert.ok(
    result.some(
      (line) =>
        line.request?.requestId === failureId &&
        line.context === "HttpErrorFilter"
    )
  )
  assert.ok(!JSON.stringify(result).includes("private-"))
  const scrape = await metrics.collect()
  assert.ok(!scrape.includes("fixture@example.test"))
  assert.ok(!scrape.includes("not-a-route/42"))
  const promQuery = async (expression) => {
    const response = await fetch(
      prometheus + "/api/v1/query?" + new URLSearchParams({ query: expression })
    )
    const data = await response.json()
    assert.equal(response.status, 200, JSON.stringify(data))
    assert.equal(data.status, "success", JSON.stringify(data))
    return data.data.result
  }
  await waitFor(async () => {
    await fetch(api + "/api/me")
    const result = await promQuery(
      'probe_success{job="webapp-template-api-probe"}'
    )
    assert.equal(
      result[0]?.value[1],
      "1",
      "Owned external readiness probe must succeed"
    )
    assert.ok(
      (await promQuery("rate(webapp_template_http_requests_total[5m])"))
        .length > 0
    )
  })
  const exporter = harness.getServiceUrl("alloy", 12345)
  const readStatistics = async () => {
    const response = await fetch(
      exporter +
        "/api/v0/component/prometheus.exporter.postgres.statements/metrics"
    )
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /pg_exporter_last_scrape_error(?:\{[^\n]*\})? 0/)
    assert.ok(!body.includes("private-sql-literal"))
    assert.ok(!/queryid=|query=|userid=/.test(body))
    return Number(
      body.match(
        /^webapp_template_postgres_statements_rows_total(?:\{[^\n]*\})? (\S+)/m
      )?.[1]
    )
  }
  const ownRows = await readStatistics()
  assert.ok(Number.isFinite(ownRows))
  harness.executePostgres(
    "CREATE ROLE webapp_template_stats_other; SET ROLE webapp_template_stats_other; SELECT * FROM generate_series(1, 10000); RESET ROLE"
  )
  assert.ok(
    (await readStatistics()) - ownRows < 10000,
    "Exporter must exclude statements executed by another role"
  )
  await waitFor(async () => {
    assert.equal(
      (await promQuery("webapp_template_postgres_statements_up"))[0]?.value[1],
      "1"
    )
    assert.ok(
      (await promQuery("webapp_template_postgres_connections_value")).length > 0
    )
    assert.ok((await promQuery("redis_memory_used_bytes")).length > 0)
    const infrastructure = await promQuery(
      '{job=~"webapp-template-postgres.*|webapp-template-valkey"}'
    )
    assert.ok(!JSON.stringify(infrastructure).includes("private-"))
    assert.ok(
      infrastructure.every(
        ({ metric }) => !metric.queryid && !metric.query && !metric.server
      )
    )
  })
  await waitFor(async () => {
    assert.ok(
      (
        await promQuery(
          "rate(webapp_template_email_dispatch_duration_seconds_bucket[5m])"
        )
      ).length > 0,
      "Email histograms need two successful scrapes"
    )
  })
  for (const uid of ["loki", "prometheus"]) {
    const health = await fetch(
      grafana + "/api/datasources/uid/" + uid + "/health"
    )
    assert.equal(health.status, 200, await health.text())
  }
  const directory = new URL(
    "../../infra/observability/grafana/dashboards/",
    import.meta.url
  )
  let checked = 0
  for (const file of (await readdir(directory)).filter((file) =>
    file.endsWith(".json")
  )) {
    const dashboard = JSON.parse(
      await readFile(new URL(file, directory), "utf8")
    )
    assert.equal(
      (await fetch(grafana + "/api/dashboards/uid/" + dashboard.uid)).status,
      200
    )
    for (const panel of dashboard.panels) {
      for (const target of panel.targets ?? []) {
        const expression = target.expr
          .replaceAll("${request_id:regex}", "")
          .replaceAll("$__rate_interval", "5m")
          .replaceAll("$__interval", "1m")
          .replaceAll("$__range", "5m")
          .replaceAll("$environment", "development")
          .replaceAll("$service", "webapp-template-api")
          .replaceAll("$instance_id", ".*")
          .replaceAll("$route", ".*")
          .replaceAll("$method", ".*")
          .replaceAll("$status", ".*")
        const isLoki = panel.datasource.uid === "loki"
        let path = "/api/v1/query"
        if (isLoki)
          path =
            target.queryType === "instant"
              ? "/loki/api/v1/query"
              : "/loki/api/v1/query_range"
        const endpoint =
          grafana + "/api/datasources/proxy/uid/" + panel.datasource.uid + path
        const response = await fetch(
          endpoint +
            "?" +
            new URLSearchParams({
              query: expression,
              since: "5m",
              limit: "1000",
            })
        )
        const body = await response.text()
        assert.equal(
          response.status,
          200,
          `${dashboard.title} / ${panel.title}: ${body}`
        )
        const payload = JSON.parse(body)
        assert.equal(payload.status, "success", body)
        if (
          [
            "API versions",
            "Most requested routes",
            "Routes with server errors",
            "Slowest successful routes (p95)",
            "PostgreSQL application connections",
            "Valkey memory",
            "Email transport outcomes",
            "Email dispatch p95",
            "SQL executions",
            "Mean SQL execution time",
            "Shared-buffer hit ratio",
            "Temporary blocks written",
            "Tracked query families",
          ].includes(panel.title) &&
          (panel.title !== "Valkey memory" || target.refId === "A")
        ) {
          assert.ok(
            payload.data.result.length > 0,
            `${panel.title} must contain fixture data`
          )
        }
        checked++
      }
    }
  }
  assert.ok(checked >= 40)
  harness.executePostgres("DROP EXTENSION pg_stat_statements")
  await waitFor(async () => {
    assert.equal(
      (await promQuery("webapp_template_postgres_statements_up"))[0]?.value[1],
      "0"
    )
    assert.equal(
      (
        await promQuery(
          "webapp_template_postgres_statements_calls_total and on(service_name, environment, instance) (webapp_template_postgres_statements_up == 1)"
        )
      ).length,
      0
    )
    assert.equal(
      (
        await promQuery('webapp_template_dependency_up{dependency="postgres"}')
      )[0]?.value[1],
      "1"
    )
  })
  assert.equal((await fetch(api + "/health/ready")).status, 200)
  harness.executePostgres(
    "CREATE EXTENSION pg_stat_statements WITH SCHEMA public"
  )
  await waitFor(async () => {
    assert.equal(
      (await promQuery("webapp_template_postgres_statements_up"))[0]?.value[1],
      "1"
    )
  })
  harness.setValkeyAvailable(false)
  assert.equal((await fetch(api + "/health/ready")).status, 503)
  assert.equal((await fetch(api + "/health/live")).status, 200)
  await waitFor(async () => {
    assert.equal(
      (await promQuery('probe_success{job="webapp-template-api-probe"}'))[0]
        ?.value[1],
      "0"
    )
  })
  await waitFor(async () => {
    assert.equal(
      (await promQuery('redis_up{job="webapp-template-valkey"}'))[0]?.value[1],
      "0"
    )
  })
  harness.setValkeyAvailable(true)
  await waitFor(async () => {
    await valkey.ready()
    assert.equal(
      (await promQuery('probe_success{job="webapp-template-api-probe"}'))[0]
        ?.value[1],
      "1"
    )
  })
  if (!preview) {
    await app.close()
    app = undefined
    await metricsServer.close()
    metricsServer = undefined
    await waitFor(async () => {
      assert.equal(
        (await promQuery('up{job="webapp-template-api"}'))[0]?.value[1],
        "0"
      )
      assert.equal(
        (await promQuery('pg_up{job="webapp-template-postgres"}'))[0]?.value[1],
        "1"
      )
      assert.equal(
        (await promQuery('redis_up{job="webapp-template-valkey"}'))[0]
          ?.value[1],
        "1"
      )
    })
  }
  console.log(
    `Verified real HTTP logs, email outcomes, PostgreSQL/Valkey observations, external readiness, both Grafana sources and ${checked} dashboard queries.`
  )
  if (preview) {
    console.log(`PREVIEW_URL=${grafana}/d/webapp-template-api-overview`)
    trafficTimer = setInterval(() => {
      void fetch(api + "/api/me").catch(console.error)
    }, 3000)
    await new Promise((resolve) => {
      process.once("SIGINT", resolve)
      process.once("SIGTERM", resolve)
    })
  }
} catch (error) {
  console.error(harness.diagnostics())
  throw error
} finally {
  clearInterval(trafficTimer)
  try {
    await Promise.all([app?.close(), metricsServer?.close()])
    metrics.close()
    await Promise.all([database?.close(), valkey?.close()])
  } finally {
    await harness.close()
  }
}
