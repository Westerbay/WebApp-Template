import request from "supertest"
import { afterEach, describe, expect, it } from "vitest"

import { createApiApp } from "../../../../src/app.js"
import { apiRateLimitConfig } from "../../../../src/infrastructure/rate-limit/rate-limit.config.js"
import type { INestApplication } from "@nestjs/common"
import type { RequestHandler } from "express"
import type { AuthSession } from "../../../../src/infrastructure/auth/session.js"

const openApps = new Set<INestApplication>()
const inertAuthHandler: RequestHandler = (_request, response) =>
  response.sendStatus(404)

const authenticatedSession: AuthSession = {
  user: {
    id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.test",
    emailVerified: true,
  },
  session: { id: "session-1" },
}

async function createRateLimitTestApp(
  authHandler: RequestHandler = inertAuthHandler
) {
  const app = await createApiApp({
    authHandler,
    getSession: () => Promise.resolve(authenticatedSession),
    listUsers: async () => ({ items: [], nextCursor: null }),
    databaseReady: () => Promise.resolve(),
  })
  openApps.add(app)
  await app.init()
  return app
}

afterEach(async () => {
  const apps = [...openApps]
  openApps.clear()
  await Promise.all(apps.map((app) => app.close()))
})

describe("Nest rate limiting", () => {
  it("limits a route by network peer even when forwarded headers change", async () => {
    const app = await createRateLimitTestApp()

    for (
      let attempt = 0;
      attempt < apiRateLimitConfig.currentUser.limit;
      attempt += 1
    ) {
      await request(app.getHttpServer())
        .get("/api/me")
        .set("X-Forwarded-For", `198.51.100.${attempt + 1}`)
        .expect(200)
    }

    const response = await request(app.getHttpServer())
      .get("/api/me")
      .set("X-Forwarded-For", "203.0.113.1")
      .expect(429)

    expect(response.body).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
      requestId: response.headers["x-request-id"],
    })
  })

  it("never limits health probes", async () => {
    const app = await createRateLimitTestApp()

    for (
      let attempt = 0;
      attempt <= apiRateLimitConfig.default.limit;
      attempt += 1
    ) {
      await request(app.getHttpServer()).get("/health/live").expect(200)
    }
  })

  it("keeps Better Auth outside the Nest guard", async () => {
    const app = await createRateLimitTestApp((_incoming, response) =>
      response.sendStatus(204)
    )

    for (
      let attempt = 0;
      attempt <= apiRateLimitConfig.default.limit;
      attempt += 1
    ) {
      await request(app.getHttpServer())
        .post("/api/auth/sign-in/email")
        .expect(204)
    }
  })
})
