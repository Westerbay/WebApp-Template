import { once } from "node:events"
import { createServer } from "node:net"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createDatabase } from "@workspace/database"
import { createApiApp } from "../../../../src/app.js"
import { startApi } from "../../../../src/bootstrap.js"
import { AuthEmailDispatcher } from "../../../../src/infrastructure/email/auth-email-dispatcher.js"
import { createApiMetrics } from "../../../../src/infrastructure/observability/metrics.js"
import { startMetricsServer } from "../../../../src/infrastructure/observability/server.js"
import { createValkey } from "../../../../src/infrastructure/valkey/valkey.js"

const state = vi.hoisted(() => {
  const cleanup: Array<() => Promise<unknown>> = []
  const closed: Array<string> = []
  const failures: {
    valkey?: Error
    app?: Error
    listen?: Error
    metrics?: Error
    serverClose?: Error
    metricsServerClose?: Error
  } = {}
  let emailDrain: Promise<void> | undefined
  let listenPort: number | undefined
  let metricsPort: number | undefined
  return { cleanup, closed, failures, emailDrain, listenPort, metricsPort }
})

vi.mock(import("@workspace/database"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createDatabase: vi.fn((url: string) => {
      // The real client is lazy; no test connects to or mutates a database.
      const database = actual.createDatabase(url)
      const close = database.close
      state.cleanup.push(close)
      vi.spyOn(database, "close").mockImplementation(() => {
        state.closed.push("database")
        return close()
      })
      return database
    }),
  }
})

vi.mock(
  import("../../../../src/infrastructure/valkey/valkey.js"),
  async (importOriginal) => {
    const actual = await importOriginal()
    return {
      createValkey: vi.fn((...args: Parameters<typeof actual.createValkey>) => {
        const valkey = actual.createValkey(...args)
        const close = valkey.close
        state.cleanup.push(close)
        vi.spyOn(valkey.client, "connect").mockImplementation(() => {
          if (state.failures.valkey)
            return Promise.reject(state.failures.valkey)
          return Promise.resolve()
        })
        vi.spyOn(valkey, "ready").mockResolvedValue(undefined)
        vi.spyOn(valkey, "close").mockImplementation(() => {
          state.closed.push("valkey")
          return close()
        })
        return valkey
      }),
    }
  }
)

vi.mock(import("../../../../src/app.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    createApiApp: vi.fn(
      async (...args: Parameters<typeof actual.createApiApp>) => {
        if (state.failures.app) throw state.failures.app
        const app = await actual.createApiApp(...args)
        const listen = app.listen.bind(app)
        const close = app.close.bind(app)
        state.cleanup.push(close)
        const listenControlled = vi.fn(() => {
          if (state.failures.listen)
            return Promise.reject(state.failures.listen)
          return listen(state.listenPort ?? 0, "127.0.0.1")
        })
        const closeControlled = vi.fn(() => {
          state.closed.push("server")
          if (state.failures.serverClose)
            return Promise.reject(state.failures.serverClose)
          return close()
        })
        // Wrap the Nest proxy instead of replacing methods it resolves dynamically.
        return new Proxy(app, {
          get(target, property, receiver) {
            if (property === "listen") return listenControlled
            if (property === "close") return closeControlled
            return Reflect.get(target, property, receiver)
          },
        })
      }
    ),
  }
})

vi.mock(
  import("../../../../src/infrastructure/observability/metrics.js"),
  async (importOriginal) => {
    const actual = await importOriginal()
    return {
      ...actual,
      createApiMetrics: vi.fn(
        (...args: Parameters<typeof actual.createApiMetrics>) => {
          const metrics = actual.createApiMetrics(...args)
          const close = metrics.close
          state.cleanup.push(async () => {
            close()
          })
          vi.spyOn(metrics, "close").mockImplementation(() => {
            state.closed.push("metrics")
            close()
          })
          return metrics
        }
      ),
    }
  }
)

vi.mock(
  import("../../../../src/infrastructure/observability/server.js"),
  async (importOriginal) => {
    const actual = await importOriginal()
    return {
      startMetricsServer: vi.fn(
        async (...args: Parameters<typeof actual.startMetricsServer>) => {
          if (state.failures.metrics) throw state.failures.metrics
          const server = await actual.startMetricsServer(args[0], {
            ...args[1],
            port: state.metricsPort ?? 0,
          })
          const close = server.close
          state.cleanup.push(async () => {
            if (server.server.listening) await close()
          })
          vi.spyOn(server, "close").mockImplementation(() => {
            state.closed.push("metrics-server")
            if (state.failures.metricsServerClose)
              return Promise.reject(state.failures.metricsServerClose)
            return close()
          })
          return server
        }
      ),
    }
  }
)

const closeEmails = AuthEmailDispatcher.prototype.close
const environment = {
  APP_ENV: "test",
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "isolated-bootstrap-fixture-not-for-production",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  WEB_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
}
const enabledInfrastructure = {
  ...environment,
  VALKEY_ENABLED: "true",
  VALKEY_URL: "redis://127.0.0.1:1",
  METRICS_ENABLED: "true",
}

beforeEach(() => {
  state.closed.length = 0
  state.failures = {}
  state.emailDrain = undefined
  state.listenPort = undefined
  state.metricsPort = undefined
  vi.clearAllMocks()
  vi.spyOn(AuthEmailDispatcher.prototype, "close").mockImplementation(
    async function (this: AuthEmailDispatcher) {
      state.closed.push("email")
      await state.emailDrain
      await closeEmails.call(this)
    }
  )
})

afterEach(async () => {
  // Release real handles even when a regression leaves startup cleanup incomplete.
  for (const close of state.cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

it("validates email configuration before acquiring any infrastructure", async () => {
  await expect(
    startApi({ ...enabledInfrastructure, SMTP_PORT: "invalid" })
  ).rejects.toThrow("Invalid email environment")
  expect(createDatabase).not.toHaveBeenCalled()
  expect(createValkey).not.toHaveBeenCalled()
  expect(createApiMetrics).not.toHaveBeenCalled()
})

it("releases a partially connected Valkey client before propagating startup failure", async () => {
  state.failures.valkey = new Error("Valkey unavailable")
  await expect(startApi(enabledInfrastructure)).rejects.toThrow(
    "Valkey startup failed"
  )
  expect(state.closed).toEqual(["valkey"])
  expect(createDatabase).not.toHaveBeenCalled()
})

it.each(["app", "listen", "metrics"] as const)(
  "cleans up acquired resources after a %s startup failure",
  async (phase) => {
    const failure = new Error(`${phase} failed`)
    state.failures[phase] = failure
    await expect(startApi(enabledInfrastructure)).rejects.toBe(failure)
    const closed = ["email", "metrics", "valkey", "database"]
    if (phase !== "app") closed.unshift("server")
    expect(state.closed).toEqual(closed)
  }
)

it("preserves startup and cleanup failures while attempting every remaining close", async () => {
  const startupFailure = new Error("metrics listener unavailable")
  const cleanupFailure = new Error("server close failed")
  state.failures.metrics = startupFailure
  state.failures.serverClose = cleanupFailure
  let failure: unknown
  try {
    await startApi(enabledInfrastructure)
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(AggregateError)
  if (!(failure instanceof AggregateError))
    throw new Error("Expected both failures")
  expect(failure.errors[0]).toBe(startupFailure)
  expect(failure.errors[1]).toBeInstanceOf(AggregateError)
  const cleanup = failure.errors[1]
  if (!(cleanup instanceof AggregateError))
    throw new Error("Expected cleanup failures")
  expect(cleanup.errors).toContain(cleanupFailure)
  expect(state.closed).toEqual([
    "server",
    "email",
    "metrics",
    "valkey",
    "database",
  ])
})

it("waits for email drain before closing telemetry and dependencies, once", async () => {
  const shutdown = await startApi(enabledInfrastructure)
  let releaseEmails = () => {}
  state.emailDrain = new Promise<void>((resolve) => {
    releaseEmails = resolve
  })
  const first = shutdown()
  expect(shutdown()).toBe(first)
  try {
    await vi.waitFor(() => expect(state.closed).toContain("email"))
    expect(state.closed).toEqual(["server", "email"])
  } finally {
    releaseEmails()
    await first
  }
  expect(state.closed).toEqual([
    "server",
    "email",
    "metrics-server",
    "metrics",
    "valkey",
    "database",
  ])
})

it("starts and stops the base API without optional infrastructure", async () => {
  const shutdown = await startApi(environment)
  await shutdown()
  expect(createApiApp).toHaveBeenCalledOnce()
  expect(createValkey).not.toHaveBeenCalled()
  expect(createApiMetrics).not.toHaveBeenCalled()
  expect(startMetricsServer).not.toHaveBeenCalled()
  expect(state.closed).toEqual(["server", "email", "database"])
})

it("releases the metrics registry and dependencies even if its listener cannot close", async () => {
  const shutdown = await startApi(enabledInfrastructure)
  state.failures.metricsServerClose = new Error("metrics listener close failed")
  await expect(shutdown()).rejects.toMatchObject({
    message: "API_SHUTDOWN_FAILED",
    errors: [state.failures.metricsServerClose],
  })
  expect(state.closed).toEqual([
    "server",
    "email",
    "metrics-server",
    "metrics",
    "valkey",
    "database",
  ])
})

it.each(["api", "metrics"] as const)(
  "releases resources after a real %s listener port conflict",
  async (listenerKind) => {
    const occupied = createServer()
    try {
      occupied.listen(0, "127.0.0.1")
      await once(occupied, "listening")
      const address = occupied.address()
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port")
      if (listenerKind === "api") state.listenPort = address.port
      else state.metricsPort = address.port

      await expect(startApi(enabledInfrastructure)).rejects.toMatchObject({
        code: "EADDRINUSE",
      })
      expect(state.closed).toEqual([
        "server",
        "email",
        "metrics",
        "valkey",
        "database",
      ])
      expect(occupied.listening).toBe(true)
    } finally {
      if (occupied.listening) {
        await new Promise<void>((resolve, reject) => {
          occupied.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        })
      }
    }
  }
)
