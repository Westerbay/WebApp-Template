import { createDatabase } from "@workspace/database"
import {
  MemoryEmailSender,
  createSmtpSender,
  getEmailConfig,
} from "@workspace/email"
import { createAuthHandler } from "./infrastructure/auth/http-handler.js"
import { createListUsers } from "./modules/users/list-users.js"
import { createApiApp } from "./app.js"
import { getEnv } from "./config/env.js"
import { createAuth } from "./infrastructure/auth/auth.js"
import { AuthEmailDispatcher } from "./infrastructure/email/auth-email-dispatcher.js"
import { createShutdown } from "./infrastructure/lifecycle/shutdown.js"
import { createApiLogger } from "./infrastructure/logging/logging.js"
import { getLoggingConfig } from "./infrastructure/logging/logging.config.js"
import { setupOpenApi } from "./openapi/document.js"
import { getValkeyConfig } from "./infrastructure/valkey/valkey.config.js"
import { createValkey } from "./infrastructure/valkey/valkey.js"
import { ValkeyRateLimitStore } from "./infrastructure/rate-limit/valkey-rate-limit-store.js"
import { getObservabilityConfig } from "./infrastructure/observability/observability.config.js"
import { createApiMetrics } from "./infrastructure/observability/metrics.js"
import { startMetricsServer } from "./infrastructure/observability/server.js"
import { createSessionReader } from "./infrastructure/auth/session.js"
import { createProviderLogger } from "./infrastructure/auth/logging.js"
import type { ValkeyConnection } from "./infrastructure/valkey/valkey.js"
import type { EmailSender } from "@workspace/core/email"
import type { EmailEvent } from "./infrastructure/email/auth-email-dispatcher.js"
import type { ShutdownEvent } from "./infrastructure/lifecycle/shutdown.js"
import type { ApiMetrics } from "./infrastructure/observability/metrics.js"
import type { MetricsServer } from "./infrastructure/observability/server.js"

import type { INestApplication } from "@nestjs/common"

export async function startApi(
  source: Record<string, string | undefined> = process.env
) {
  // Reject configuration before opening clients, listeners or log destinations.
  const env = getEnv(source)
  const valkeyConfig = getValkeyConfig(source)
  const observability = getObservabilityConfig(source)
  const emailConfig = getEmailConfig(source)
  const logging = getLoggingConfig(env.APP_ENV, source)
  const logger = createApiLogger(env.APP_ENV, undefined, {
    ...logging,
    version: observability.APP_VERSION,
  })

  let database: ReturnType<typeof createDatabase> | undefined
  let valkey: ValkeyConnection | undefined
  let metrics: ApiMetrics | undefined
  let emails: AuthEmailDispatcher | undefined
  let app: INestApplication | undefined
  let metricsServer: MetricsServer | undefined

  const closeServer = () => app?.close()
  const closeEmails = () => emails?.close()
  const closeMetricsServer = () => metricsServer?.close()
  const closeMetrics = () => metrics?.close()
  const closeValkey = () => valkey?.close()
  const closeDatabase = () => database?.close()
  const reportShutdownEvent = (event: ShutdownEvent) => {
    if (event.event === "api.shutdown_failed") logger.error(event)
    else logger.info(event)
  }
  const shutdown = createShutdown(
    [
      { name: "server", close: closeServer },
      { name: "email", close: closeEmails },
      { name: "metrics-server", close: closeMetricsServer },
      { name: "metrics", close: closeMetrics },
      { name: "valkey", close: closeValkey },
      { name: "database", close: closeDatabase },
    ],
    reportShutdownEvent
  )

  try {
    const reportValkeyUnavailable = () => {
      logger.warn({ event: "valkey.unavailable" })
    }
    if (valkeyConfig.VALKEY_ENABLED === "true" && valkeyConfig.VALKEY_URL) {
      valkey = createValkey(valkeyConfig.VALKEY_URL, reportValkeyUnavailable)
      try {
        await valkey.client.connect()
        await valkey.ready()
      } catch (error) {
        throw new Error("Valkey startup failed", { cause: error })
      }
    }
    database = createDatabase(env.DATABASE_URL)
    const db = database.db
    const databaseReady = database.ready
    if (observability.METRICS_ENABLED === "true") {
      metrics = createApiMetrics(env.APP_ENV, observability.APP_VERSION, {
        valkey: Boolean(valkey),
      })
    }
    let sender: EmailSender
    if (emailConfig.EMAIL_MODE === "memory") {
      sender = new MemoryEmailSender()
    } else {
      sender = createSmtpSender(emailConfig)
    }

    const reportEmailEvent = (event: EmailEvent) => {
      metrics?.recordEmail(event)
      if (event.event === "email.accepted") logger.info(event)
      else logger.error(event)
    }
    emails = new AuthEmailDispatcher(sender, reportEmailEvent)
    const auth = createAuth(db, env, emails, createProviderLogger(logger))
    const getSession = createSessionReader(auth.api)
    const infrastructureReady = async () => {
      await Promise.all([databaseReady(), valkey?.ready()])
    }
    let rateLimitStorage: ValkeyRateLimitStore | undefined
    if (valkey) {
      rateLimitStorage = new ValkeyRateLimitStore(
        valkey.client,
        valkeyConfig.VALKEY_NAMESPACE
      )
    }
    app = await createApiApp({
      authHandler: createAuthHandler(auth),
      getSession,
      listUsers: createListUsers(db),
      databaseReady: infrastructureReady,
      rateLimitStorage,
      allowedOrigin: env.WEB_URL,
      logger,
      metrics,
    })
    if (source.NODE_ENV !== "production") setupOpenApi(app)
    await app.listen(env.API_PORT)
    if (metrics) {
      metricsServer = await startMetricsServer(metrics, {
        host: observability.METRICS_HOST,
        port: observability.METRICS_PORT,
      })
    }
    logger.info({ event: "api.started", port: env.API_PORT })
    return shutdown
  } catch (error) {
    logger.error({ event: "api.startup_failed" })
    try {
      await shutdown()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "API_STARTUP_FAILED", {
        cause: error,
      })
    }
    throw error
  }
}
