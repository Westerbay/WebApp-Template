import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export const logsTestConfig = {
  startupTimeoutMs: 60_000,
  pollIntervalMs: 1000,
  lokiPort: 3100,
  grafanaPort: 3000,
  prometheusPort: 9090,
  queryWindow: "5m",
  queryLimit: "1000",
  diagnosticTail: "15",
}

export async function createLogsTestHarness() {
  const root = fileURLToPath(new URL("../../../", import.meta.url))
  const output = fileURLToPath(new URL("../../../output/", import.meta.url))
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(output + "logs-test-")
  const project = "webapp-template-logs-" + randomUUID()
  const override = directory + "/compose.yml"
  await writeFile(
    override,
    `services:
    loki:
      ports: !override
        - "127.0.0.1::${logsTestConfig.lokiPort}"
    grafana:
      ports: !override
        - "127.0.0.1::${logsTestConfig.grafanaPort}"
    prometheus:
      ports: !override
        - "127.0.0.1::${logsTestConfig.prometheusPort}"
    alloy:
      environment:
        OBS_POSTGRES_DSN: "postgresql://webapp_template_auth_test:isolated-fixture-only@postgres:5432/webapp_template_auth_test?sslmode=disable&connect_timeout=2&statement_timeout=1500&default_transaction_read_only=on"
        OBS_VALKEY_URL: redis://valkey:6379
      ports: !override ["127.0.0.1::12345"]
      volumes:
        - ${directory}:/var/log/webapp-template:ro
  `
  )

  const configureMetrics = async (apiPort, metricsPort) => {
    const config = await readFile(
      new URL(
        "../../../infra/observability/prometheus/prometheus.yml",
        import.meta.url
      ),
      "utf8"
    )
    const prometheusConfig = directory + "/prometheus.yml"
    await writeFile(
      prometheusConfig,
      config
        .replace("scrape_interval: 15s", "scrape_interval: 5s")
        .replace("evaluation_interval: 15s", "evaluation_interval: 2s")
        .replace(
          "host.docker.internal:9464",
          "host.docker.internal:" + metricsPort
        )
        .replace("host.docker.internal:3001", "host.docker.internal:" + apiPort)
    )
    const overrideConfig = (await readFile(override, "utf8")).replace(
      "    prometheus:\n",
      `    prometheus:\n      volumes:\n        - ${prometheusConfig}:/etc/prometheus/prometheus.yml:ro\n`
    )
    await writeFile(
      override,
      overrideConfig +
        `
    postgres:
      image: postgres:17.11-alpine3.24
      command: ["postgres", "-c", "shared_preload_libraries=pg_stat_statements", "-c", "compute_query_id=auto"]
      volumes:
        - ${root}infra/postgres/query-statistics.sql:/docker-entrypoint-initdb.d/query-statistics.sql:ro
      environment:
        POSTGRES_DB: webapp_template_auth_test
        POSTGRES_USER: webapp_template_auth_test
        POSTGRES_PASSWORD: isolated-fixture-only
      ports: ["127.0.0.1::5432"]
      tmpfs: [/var/lib/postgresql/data]
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U webapp_template_auth_test -d webapp_template_auth_test"]
        interval: 1s
        timeout: 3s
        retries: 40
    valkey:
      image: valkey/valkey:8.1.10-alpine3.24
      command: ["valkey-server", "--save", "", "--appendonly", "no"]
      ports: ["127.0.0.1::6379"]
  `
    )
  }

  const compose = (...args) =>
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-p",
        project,
        "-f",
        "infra/compose/observability.yml",
        "-f",
        override,
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )

  const getServiceUrl = (service, containerPort) => {
    const address = compose("port", service, String(containerPort)).trim()
    return "http://" + address
  }

  const probes = []
  let collectorStarted = false
  const collectorOverride = directory + "/collector.yml"
  const collectorCompose = (...args) =>
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-p",
        project + "-collector",
        "-f",
        "infra/compose/logs-collector.yml",
        "-f",
        collectorOverride,
        ...args,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          APP_ENV: "staging",
          LOKI_URL: "http://loki:3100/loki/api/v1/push",
          LOKI_TOKEN_FILE: "",
          LOKI_TENANT_ID: "",
        },
      }
    )
  const startDockerCollector = async () => {
    await writeFile(
      collectorOverride,
      [
        "networks:",
        "  default:",
        "    external: true",
        "    name: " + project + "_default",
        "",
      ].join("\n")
    )
    collectorStarted = true
    collectorCompose("up", "-d")
  }
  const createLogProbe = async (environment, enabled) => {
    const name = project + "-" + environment + "-" + String(enabled)
    const file = directory + "/" + name + ".jsonl"
    await writeFile(
      file,
      JSON.stringify({
        service_name: "webapp-template-api",
        environment,
        level: 30,
        time: Date.now(),
        instance_id: "docker-probe",
        event:
          "probe." + environment + "." + (enabled ? "enabled" : "disabled"),
      }) + "\n"
    )
    probes.push(name)
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        "webapp-template.logs=" + String(enabled),
        "--label",
        "webapp-template.logs.environment=" + environment,
        "--label",
        "com.docker.compose.service=renamed-api",
        "-v",
        file + ":/probe.jsonl:ro",
        "--entrypoint",
        "/bin/sh",
        "grafana/grafana:13.2.4",
        "-c",
        "sleep 3; cat /probe.jsonl; sleep 120",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )
  }

  const start = () => compose("up", "-d")
  const diagnostics = () =>
    compose("logs", "--tail", logsTestConfig.diagnosticTail)
  const close = async () => {
    try {
      if (collectorStarted)
        collectorCompose("down", "--volumes", "--remove-orphans")
    } finally {
      for (const name of probes) {
        execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" })
      }
      compose("down", "--volumes", "--remove-orphans")
    }
    await rm(directory, { recursive: true, force: true })
  }
  return {
    directory,
    start,
    getServiceUrl,
    diagnostics,
    close,
    startDockerCollector,
    createLogProbe,
    configureMetrics,
    executePostgres: (statement) =>
      compose(
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "webapp_template_auth_test",
        "-d",
        "webapp_template_auth_test",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        statement
      ),
    setValkeyAvailable: (available) =>
      // Preserve the random published port while simulating a stalled dependency.
      compose(available ? "unpause" : "pause", "valkey"),
  }
}

export async function waitFor(check) {
  const deadline = Date.now() + logsTestConfig.startupTimeoutMs
  const pause = () => {
    const waitInterval = (resolve) =>
      setTimeout(resolve, logsTestConfig.pollIntervalMs)
    return new Promise(waitInterval)
  }
  let lastError
  while (Date.now() < deadline) {
    try {
      return await check()
    } catch (error) {
      lastError = error
    }
    await pause()
  }
  throw lastError
}
