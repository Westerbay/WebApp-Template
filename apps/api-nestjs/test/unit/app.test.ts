import { PassThrough } from "node:stream"
import { Body, Controller, Post } from "@nestjs/common"
import { APP_FILTER, APP_PIPE } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import express from "express"
import {
  ZodValidationException,
  ZodValidationPipe,
  createZodDto,
} from "nestjs-zod"
import request from "supertest"
import { z } from "zod"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createApiApp } from "../../src/app.js"
import { HttpErrorFilter } from "../../src/infrastructure/http/http-error.filter.js"
import { requestContext } from "../../src/infrastructure/http/request-context.js"
import { createApiLogger } from "../../src/infrastructure/logging/logging.js"
import type { INestApplication } from "@nestjs/common"
import type { RequestHandler } from "express"
import type { Logger } from "pino"
import type { ApiDependencies } from "../../src/app.js"
import type {
  AuthSession,
  GetSession,
} from "../../src/infrastructure/auth/session.js"

const openApps = new Set<INestApplication>()
const inertAuthHandler: RequestHandler = (_request, response) =>
  response.sendStatus(404)

const validationHandler = vi.fn()
const validationProbeSchema = z.object({ email: z.email() })

class ValidationProbeDto extends createZodDto(validationProbeSchema) {}

@Controller("test/validation")
class ValidationProbeController {
  @Post()
  validate(@Body() _body: ValidationProbeDto) {
    validationHandler()
    return { ok: true }
  }
}

type TestDependencies = Readonly<{
  authHandler?: RequestHandler
  getSession?: GetSession
  listUsers?: ApiDependencies["listUsers"]
  databaseReady?: () => Promise<void>
  readinessTimeoutMs?: number
  logger?: Logger
}>

async function createTestApp(dependencies: TestDependencies = {}) {
  const apiDependencies: ApiDependencies = {
    authHandler: dependencies.authHandler ?? inertAuthHandler,
    getSession: dependencies.getSession ?? (() => Promise.resolve(null)),
    listUsers:
      dependencies.listUsers ?? (async () => ({ items: [], nextCursor: null })),
    databaseReady: dependencies.databaseReady ?? (() => Promise.resolve()),
    ...(dependencies.readinessTimeoutMs === undefined
      ? {}
      : { readinessTimeoutMs: dependencies.readinessTimeoutMs }),
    ...(dependencies.logger ? { logger: dependencies.logger } : {}),
  }
  const app = await createApiApp(apiDependencies)
  openApps.add(app)
  return app
}

async function createValidationTestApp() {
  const module = await Test.createTestingModule({
    controllers: [ValidationProbeController],
    providers: [
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      { provide: APP_FILTER, useClass: HttpErrorFilter },
    ],
  }).compile()
  const app = module.createNestApplication()
  app.use(requestContext)
  app.use(express.json())
  openApps.add(app)
  return app
}

type SessionOverrides = Readonly<{
  email?: string
  emailVerified?: boolean
}>

function createSession(overrides: SessionOverrides = {}): AuthSession {
  return {
    user: {
      id: "user-1",
      name: "Ada Lovelace",
      email: overrides.email ?? "ada@example.test",
      emailVerified: overrides.emailVerified ?? true,
    },
    session: { id: "session-1" },
  }
}

afterEach(async () => {
  validationHandler.mockReset()
  const apps = [...openApps]
  openApps.clear()
  await Promise.all(apps.map((app) => app.close()))
})

describe("API", () => {
  it("returns readiness only after the database responds", async () => {
    const databaseReady = vi.fn(() => Promise.resolve())
    const app = await createTestApp({ databaseReady })
    await app.init()

    await request(app.getHttpServer())
      .get("/health/ready")
      .expect(200, { status: "ok" })
    expect(databaseReady).toHaveBeenCalledOnce()
  })

  it("keeps liveness available and bounds readiness when the database stalls", async () => {
    const app = await createTestApp({
      databaseReady: () => new Promise(() => {}),
      readinessTimeoutMs: 20,
    })
    await app.init()

    await request(app.getHttpServer())
      .get("/health/live")
      .expect(200, { status: "ok" })
    const response = await request(app.getHttpServer())
      .get("/health/ready")
      .expect(503)
    expect(response.body).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Service unavailable",
    })
  })

  it("logs safe HTTP metadata with the response request id", async () => {
    const destination = new PassThrough()
    let output = ""
    destination.on("data", (chunk) => {
      output += chunk.toString()
    })
    const app = await createTestApp({
      logger: createApiLogger("staging", destination),
    })
    await app.init()

    const response = await request(app.getHttpServer())
      .get("/health/live?token=private-token")
      .set("Authorization", "Bearer private-authorization")
      .set("Cookie", "session=private-cookie")
      .expect(200)

    expect(output).toContain(
      `"requestId":"${response.headers["x-request-id"]}"`
    )
    expect(output).toContain('"method":"GET"')
    expect(output).toContain('"path":"/health/live"')
    expect(output).toContain('"status":200')
    expect(output).toContain('"durationMs":')
    expect(output).not.toContain("private-token")
    expect(output).not.toContain("private-authorization")
    expect(output).not.toContain("private-cookie")
  })

  it("delegates auth routes to the Better Auth handler boundary", async () => {
    const app = await createTestApp({
      authHandler: (incoming, response) =>
        response.status(200).json({ path: incoming.originalUrl }),
    })
    await app.listen(0, "127.0.0.1")

    await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .send({ email: "user@example.test" })
      .expect(200, { path: "/api/auth/sign-up/email" })
  })

  it("rejects protected Nest routes without a session", async () => {
    const app = await createTestApp()
    await app.init()

    const response = await request(app.getHttpServer())
      .get("/api/me")
      .expect(401)

    expect(response.body).toEqual({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      requestId: response.headers["x-request-id"],
    })
  })

  it("returns a cleaned validation error before a controller handles invalid input", async () => {
    const app = await createValidationTestApp()
    await app.init()

    const response = await request(app.getHttpServer())
      .post("/test/validation")
      .send({ email: "private invalid email" })
      .expect(400)

    expect(validationHandler).not.toHaveBeenCalled()
    expect(response.body).toEqual({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      requestId: response.headers["x-request-id"],
      details: [{ code: "invalid_format", path: "email" }],
    })
    expect(JSON.stringify(response.body)).not.toContain("private invalid email")
  })

  it("omits unsupported validation details without breaking the error response", async () => {
    validationHandler.mockImplementationOnce(() => {
      throw new ZodValidationException({ issues: [null] })
    })
    const app = await createValidationTestApp()
    await app.init()

    const response = await request(app.getHttpServer())
      .post("/test/validation")
      .send({ email: "valid@example.test" })
      .expect(400)

    expect(response.body).toEqual({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      requestId: response.headers["x-request-id"],
      details: [],
    })
  })

  it("exposes only validation codes and nested paths from adapter errors", async () => {
    validationHandler.mockImplementationOnce(() => {
      throw new ZodValidationException({
        issues: [
          {
            code: "invalid_type",
            path: ["users", 0, "email"],
            message: "private validation message",
            input: "private input",
          },
        ],
      })
    })
    const app = await createValidationTestApp()
    await app.init()

    const response = await request(app.getHttpServer())
      .post("/test/validation")
      .send({ email: "valid@example.test" })
      .expect(400)

    expect(response.body.details).toEqual([
      { code: "invalid_type", path: "users.0.email" },
    ])
    expect(JSON.stringify(response.body)).not.toContain("private")
  })

  it("returns the authenticated identity from /api/me", async () => {
    const app = await createTestApp({
      getSession: () => Promise.resolve(createSession()),
    })
    await app.init()

    await request(app.getHttpServer()).get("/api/me").expect(200, {
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.test",
      emailVerified: true,
    })
  })

  it("rejects a session whose email identity is not verified", async () => {
    const app = await createTestApp({
      getSession: () =>
        Promise.resolve(createSession({ emailVerified: false })),
    })
    await app.init()

    await request(app.getHttpServer()).get("/api/me").expect(403)
  })

  it("does not expose an invalid response or its validation details", async () => {
    const app = await createTestApp({
      getSession: () =>
        Promise.resolve(createSession({ email: "not-an-email" })),
    })
    await app.init()

    const response = await request(app.getHttpServer())
      .get("/api/me")
      .expect(500)

    expect(response.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId: response.headers["x-request-id"],
    })
    expect(JSON.stringify(response.body)).not.toContain("not-an-email")
  })
})

it("protects the users list before invoking its data reader", async () => {
  const listUsers = vi.fn(async () => ({ items: [], nextCursor: null }))
  const anonymous = await createTestApp({ listUsers })
  await anonymous.init()
  await request(anonymous.getHttpServer()).get("/api/users").expect(401)
  const unverified = await createTestApp({
    listUsers,
    getSession: async () => createSession({ emailVerified: false }),
  })
  await unverified.init()
  await request(unverified.getHttpServer()).get("/api/users").expect(403)
  expect(listUsers).not.toHaveBeenCalled()
})

it("validates pagination before reading users and strips private fields from responses", async () => {
  const listUsers = vi.fn(async () => ({
    items: [{ ...createSession().user, password: "private-hash" }],
    nextCursor: null,
  }))
  const app = await createTestApp({
    listUsers,
    getSession: async () => createSession(),
  })
  await app.init()
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.5",
    "limit=abc",
    "cursor=",
  ]) {
    await request(app.getHttpServer()).get(`/api/users?${query}`).expect(400)
  }
  expect(listUsers).not.toHaveBeenCalled()
  await request(app.getHttpServer())
    .get("/api/users?limit=2&cursor=previous")
    .expect(200, { items: [createSession().user], nextCursor: null })
  expect(listUsers).toHaveBeenCalledWith({ limit: 2, cursor: "previous" })
})
