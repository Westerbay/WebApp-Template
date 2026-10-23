import "reflect-metadata"

import { Module } from "@nestjs/common"
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
  NestFactory,
} from "@nestjs/core"
import cors from "cors"
import express from "express"
import { ZodSerializerInterceptor, ZodValidationPipe } from "nestjs-zod"
import { Logger as PinoNestLogger } from "nestjs-pino"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { apiConfig } from "./config/api.config.js"

import { AUTH_SESSION_READER, AuthGuard } from "./infrastructure/auth/guard.js"
import { HttpErrorFilter } from "./infrastructure/http/http-error.filter.js"
import { requestContext } from "./infrastructure/http/request-context.js"
import { apiThrottlerOptions } from "./infrastructure/rate-limit/rate-limit.config.js"
import { createApiLogger } from "./infrastructure/logging/logging.js"
import { createHttpLogging } from "./infrastructure/logging/http-logging.js"
import { HealthController } from "./modules/health/health.controller.js"
import {
  DATABASE_READINESS,
  READINESS_TIMEOUT,
} from "./modules/health/readiness.js"
import { IdentityController } from "./modules/identity/identity.controller.js"
import { UsersController } from "./modules/users/users.controller.js"
import { LIST_USERS } from "./modules/users/users.types.js"
import type { ThrottlerStorage } from "@nestjs/throttler"
import type { INestApplication } from "@nestjs/common"
import type { RequestHandler } from "express"
import type { Logger } from "pino"
import type { GetSession } from "./infrastructure/auth/session.js"

import type { ListUsers } from "./modules/users/users.types.js"
import type { ApiMetrics } from "./infrastructure/observability/metrics.js"

export type ApiDependencies = Readonly<{
  authHandler: RequestHandler
  getSession: GetSession
  listUsers: ListUsers
  databaseReady: () => Promise<void>
  allowedOrigin?: string
  readinessTimeoutMs?: number
  logger?: Logger
  rateLimitStorage?: ThrottlerStorage
  metrics?: ApiMetrics
}>

export async function createApiApp(
  dependencies: ApiDependencies
): Promise<INestApplication> {
  const logger = dependencies.logger ?? createApiLogger("test")
  const httpLogging = createHttpLogging(logger)

  @Module({
    imports: [
      httpLogging.module,
      ThrottlerModule.forRoot({
        ...apiThrottlerOptions,
        storage: dependencies.rateLimitStorage,
      }),
    ],
    controllers: [HealthController, IdentityController, UsersController],
    providers: [
      { provide: LIST_USERS, useValue: dependencies.listUsers },
      { provide: AUTH_SESSION_READER, useValue: dependencies.getSession },
      { provide: DATABASE_READINESS, useValue: dependencies.databaseReady },
      {
        provide: READINESS_TIMEOUT,
        useValue:
          dependencies.readinessTimeoutMs ?? apiConfig.readinessTimeoutMs,
      },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
      { provide: APP_FILTER, useClass: HttpErrorFilter },
    ],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
    abortOnError: false,
  })
  try {
    app.useLogger(app.get(PinoNestLogger))
    const expressApp = app.getHttpAdapter().getInstance()

    expressApp.use(httpLogging.middleware)
    if (dependencies.metrics) expressApp.use(dependencies.metrics.middleware)
    expressApp.use(requestContext)
    expressApp.use(
      cors({
        origin: dependencies.allowedOrigin ?? apiConfig.defaultAllowedOrigin,
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      })
    )
    expressApp.use(
      "/api/auth",
      (
        request: express.Request,
        _response: express.Response,
        next: express.NextFunction
      ) => {
        // The socket peer is authoritative until a specific trusted proxy is configured.
        request.headers["x-auth-client-ip"] =
          request.socket.remoteAddress ?? "127.0.0.1"
        next()
      },
      dependencies.authHandler
    )
    expressApp.use(express.json())

    return app
  } catch (error) {
    try {
      await app.close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "API_HTTP_SETUP_FAILED", {
        cause: error,
      })
    }
    throw error
  }
}
