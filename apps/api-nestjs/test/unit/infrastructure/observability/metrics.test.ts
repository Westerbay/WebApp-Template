import { PassThrough } from "node:stream"
import { Controller, Get } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import request from "supertest"
import { Router } from "express"
import { describe, expect, it } from "vitest"
import { createApiLogger } from "../../../../src/infrastructure/logging/logging.js"
import { createApiApp } from "../../../../src/app.js"
import { createApiMetrics } from "../../../../src/infrastructure/observability/metrics.js"
import { startMetricsServer } from "../../../../src/infrastructure/observability/server.js"

it("measures HTTP outcomes once and bounds route labels without private data", async () => {
  const metrics = createApiMetrics("test", "test-release")
  const destination = new PassThrough()
  let logs = ""
  destination.on("data", (chunk) => {
    logs += chunk.toString()
  })
  const authHandler = Router()
  authHandler.post("/sign-in/email", (_request, response) =>
    response.sendStatus(429)
  )
  authHandler.get("/reset-password/:token", (_request, response) =>
    response.sendStatus(429)
  )
  const app = await createApiApp({
    metrics,
    logger: createApiLogger("staging", destination),
    authHandler,
    getSession: async () => null,
    listUsers: async () => ({ items: [], nextCursor: null }),
    databaseReady: async () => {},
  })
  try {
    await app.init()
    await request(app.getHttpServer()).get("/health/live").expect(200)
    await request(app.getHttpServer())
      .get("/api/me?token=private-token")
      .expect(401)
    await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .expect(429)
    await request(app.getHttpServer())
      .get("/api/auth/reset-password/private-token")
      .expect(429)
    for (const path of ["private-user-one", "private-user-two"]) {
      await request(app.getHttpServer()).get(`/unknown/${path}`).expect(404)
    }
    const result = await metrics.registry.getMetricsAsJSON()
    const requests = result.find(
      (metric) => metric.name === "webapp_template_http_requests_total"
    )
    expect(requests?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 1,
          labels: expect.objectContaining({ route: "/api/me", status: "401" }),
        }),
        expect.objectContaining({
          value: 1,
          labels: expect.objectContaining({
            route: "/api/auth/sign-in/email",
            status: "429",
          }),
        }),
        expect.objectContaining({
          value: 1,
          labels: expect.objectContaining({
            route: "/api/auth/reset-password/:token",
            status: "429",
          }),
        }),
        expect.objectContaining({
          value: 2,
          labels: expect.objectContaining({
            route: "unmatched",
            status: "404",
          }),
        }),
      ])
    )
    expect(JSON.stringify(result)).not.toContain("private-")
    expect(logs).not.toContain("private-")
    expect(logs).toContain('"path":"/api/auth/reset-password/:token"')
    const body = await metrics.registry.metrics()
    expect(body).toContain(
      "webapp_template_http_request_duration_seconds_bucket"
    )
    expect(body).toContain("process_resident_memory_bytes")
    expect(body).toContain('version="test-release"')
  } finally {
    await app.close()
    metrics.close()
  }
})

describe("private metrics listener", () => {
  it("serves only GET /metrics independently of API authentication and closes cleanly", async () => {
    const metrics = createApiMetrics("test", "test-release")
    const server = await startMetricsServer(metrics, {
      host: "127.0.0.1",
      port: 0,
    })
    try {
      await request(server.server)
        .get("/metrics")
        .expect("Content-Type", /text\/plain/)
        .expect(200)
      await request(server.server).get("/anything").expect(404)
      await request(server.server).post("/metrics").expect(405)
    } finally {
      await server.close()
      metrics.close()
    }
    expect(server.server.listening).toBe(false)
  })
})

@Controller("api/extensions")
class ExtensionController {
  @Get(":id")
  read() {
    return { ok: true }
  }
}

it("observes a new Nest controller without registering telemetry routes", async () => {
  const metrics = createApiMetrics("test", "test-release")
  const module = await Test.createTestingModule({
    controllers: [ExtensionController],
  }).compile()
  const app = module.createNestApplication({ logger: false })
  app.use(metrics.middleware)
  try {
    await app.init()
    for (const id of ["private-first", "private-second"])
      await request(app.getHttpServer())
        .get(`/api/extensions/${id}`)
        .expect(200)
    const result = await metrics.registry.getMetricsAsJSON()
    const requests = result.find(
      (metric) => metric.name === "webapp_template_http_requests_total"
    )
    expect(requests?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 2,
          labels: expect.objectContaining({
            route: "/api/extensions/:id",
            status: "200",
          }),
        }),
      ])
    )
    expect(JSON.stringify(result)).not.toContain("private-")
  } finally {
    await app.close()
    metrics.close()
  }
})
