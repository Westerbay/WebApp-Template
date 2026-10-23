import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { createApiApp } from "../../../../src/app.js"
import { createValkey } from "../../../../src/infrastructure/valkey/valkey.js"
import { getValkeyConfig } from "../../../../src/infrastructure/valkey/valkey.config.js"
import { ValkeyRateLimitStore } from "../../../../src/infrastructure/rate-limit/valkey-rate-limit-store.js"

describe("optional Valkey integration", () => {
  it("refuses ambiguous activation and hides invalid connection secrets", () => {
    expect(getValkeyConfig({}).VALKEY_ENABLED).toBe("false")
    expect(() => getValkeyConfig({ VALKEY_ENABLED: "true" })).toThrow(
      "VALKEY_URL"
    )
    expect(() =>
      getValkeyConfig({ VALKEY_URL: "redis://localhost:6379" })
    ).toThrow("VALKEY_ENABLED")
    expect(() =>
      getValkeyConfig({
        VALKEY_ENABLED: "true",
        VALKEY_URL: "https://secret:password@localhost",
      })
    ).toThrow("Invalid VALKEY_URL")
    expect(() =>
      getValkeyConfig({
        VALKEY_ENABLED: "true",
        VALKEY_URL: "redis://localhost",
        VALKEY_NAMESPACE: "bad{scope}",
      })
    ).toThrow("Invalid Valkey configuration")
  })

  it("fails closed over HTTP while keeping liveness available", async () => {
    const connection = createValkey("redis://127.0.0.1:1", () => {})
    const store = new ValkeyRateLimitStore(connection.client, "test")
    const app = await createApiApp({
      authHandler: (_incoming, response) => response.sendStatus(404),
      getSession: async () => null,
      listUsers: async () => ({ items: [], nextCursor: null }),
      databaseReady: connection.ready,
      rateLimitStorage: store,
    })
    try {
      await app.init()
      await request(app.getHttpServer()).get("/api/me").expect(503)
      await request(app.getHttpServer()).get("/health/ready").expect(503)
      await request(app.getHttpServer()).get("/health/live").expect(200)
    } finally {
      await app.close()
      await connection.close()
    }
  })

  it("converts storage milliseconds into HTTP header seconds", async () => {
    const connection = createValkey("redis://127.0.0.1:1", () => {})
    const evaluate = vi
      .spyOn(connection.client, "eval")
      .mockResolvedValue([31, 1501, 1, 2501])
    try {
      const store = new ValkeyRateLimitStore(connection.client, "test")
      expect(await store.increment("peer", 60000, 30, 60000, "api")).toEqual({
        totalHits: 31,
        timeToExpire: 2,
        isBlocked: true,
        timeToBlockExpire: 3,
      })
      expect(evaluate.mock.calls[0]?.slice(2, 5).join(" ")).not.toContain(
        "peer"
      )
      evaluate.mockResolvedValueOnce([31, -1, 1, 0])
      await expect(
        store.increment("peer", 60000, 30, 60000, "api")
      ).rejects.toThrow()
    } finally {
      await connection.close()
    }
  })
})
