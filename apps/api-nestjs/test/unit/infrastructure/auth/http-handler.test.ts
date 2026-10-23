import { PassThrough } from "node:stream"
import { betterAuth } from "better-auth"
import { createAuthEndpoint } from "better-auth/api"
import request from "supertest"
import { expect, it } from "vitest"
import { createApiApp } from "../../../../src/app.js"
import { createAuthHandler } from "../../../../src/infrastructure/auth/http-handler.js"
import { createApiLogger } from "../../../../src/infrastructure/logging/logging.js"
import { createApiMetrics } from "../../../../src/infrastructure/observability/metrics.js"

it("discovers plugin routes and core routes without exposing parameters in metrics or logs", async () => {
  const auth = betterAuth({
    baseURL: "http://localhost:3001",
    secret: "isolated-observability-test-secret-only",
    disabledPaths: ["/disabled"],
    plugins: [
      {
        id: "observability-test",
        endpoints: {
          inspect: createAuthEndpoint(
            "/inspect/:token",
            { method: "GET" },
            async (ctx) => ctx.json({ ok: true })
          ),
          inspectLatest: createAuthEndpoint(
            "/inspect/latest",
            { method: "POST" },
            async (ctx) => ctx.json({ ok: true })
          ),
          files: createAuthEndpoint(
            "/files/**",
            { method: "GET" },
            async (ctx) => ctx.json({ ok: true })
          ),
          disabled: createAuthEndpoint(
            "/disabled",
            { method: "GET" },
            async (ctx) => ctx.json({ ok: true })
          ),
          multiMethod: createAuthEndpoint(
            "/multiple/:id",
            { method: ["GET", "POST"] },
            async (ctx) => ctx.json({ ok: true })
          ),
          serverOnly: createAuthEndpoint(
            "/internal/:token",
            { method: "GET", metadata: { SERVER_ONLY: true } },
            async (ctx) => ctx.json({ ok: true })
          ),
        },
      },
    ],
  })
  const metrics = createApiMetrics("test", "test-release")
  const destination = new PassThrough()
  let logs = ""
  destination.on("data", (chunk) => {
    logs += chunk.toString()
  })
  const app = await createApiApp({
    authHandler: createAuthHandler(auth),
    metrics,
    logger: createApiLogger("staging", destination),
    getSession: async () => null,
    listUsers: async () => ({ items: [], nextCursor: null }),
    databaseReady: async () => {},
  })
  try {
    await app.init()
    const http = request(app.getHttpServer())
    await http
      .get("/api/auth/inspect/private-token?secret=private-query")
      .expect(200)
    await http.post("/api/auth/inspect/latest").expect(200)
    await http.get("/api/auth/files/private-folder/private-file").expect(200)
    await http.get("/api/auth/ok").expect(200)
    await http.get("/api/auth/get-session").expect(200)
    await http.get("/api/auth/reset-password/private-token").expect(400)
    await http.get("/api/auth/multiple/private-id").expect(200)
    await http.post("/api/auth/multiple/private-id").expect(200)
    await http.get("/api/auth/disabled").expect(404)
    await http.get("/api/auth/internal/private-token").expect(404)
    await http.get("/api/auth/unknown/private-token").expect(404)
    const result = await metrics.registry.getMetricsAsJSON()
    const requests = result.find(
      (metric) => metric.name === "webapp_template_http_requests_total"
    )
    expect(requests?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/inspect/:token",
            method: "GET",
            status: "200",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/inspect/latest",
            method: "POST",
            status: "200",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/files/**",
            status: "200",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/ok",
            status: "200",
          }),
        }),
        expect.objectContaining({
          value: 3,
          labels: expect.objectContaining({
            route: "/api/auth/*",
            status: "404",
          }),
        }),
      ])
    )
    expect(requests?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/get-session",
            status: "200",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/reset-password/:token",
            status: "400",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/multiple/:id",
            method: "GET",
            status: "200",
          }),
        }),
        expect.objectContaining({
          labels: expect.objectContaining({
            route: "/api/auth/multiple/:id",
            method: "POST",
            status: "200",
          }),
        }),
      ])
    )
    expect(logs).toContain('"route":"/api/auth/inspect/:token"')
    expect(JSON.stringify(result)).not.toContain("private-")
    expect(logs).not.toContain("private-")
    expect(logs).toContain('"path":"/api/auth/inspect/:token"')
    expect(logs).toContain('"path":"/api/auth/files/**"')
  } finally {
    await app.close()
    metrics.close()
  }
})
