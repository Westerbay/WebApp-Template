import { ExpressAdapter } from "@nestjs/platform-express"
import { expect, it, vi } from "vitest"
import { createApiApp } from "../../../../src/app.js"
import { createApiMetrics } from "../../../../src/infrastructure/observability/metrics.js"

it("closes an acquired Nest adapter when HTTP middleware setup fails", async () => {
  const failure = new Error("middleware setup failed")
  const metrics = createApiMetrics("test", "setup-fixture")
  Object.defineProperty(metrics, "middleware", {
    get() {
      throw failure
    },
  })
  const close = vi.spyOn(ExpressAdapter.prototype, "close")
  try {
    await expect(
      createApiApp({
        authHandler: (_request, response) => response.sendStatus(404),
        getSession: async () => null,
        listUsers: async () => ({ items: [], nextCursor: null }),
        databaseReady: async () => {},
        metrics,
      })
    ).rejects.toBe(failure)
    expect(close).toHaveBeenCalledOnce()
  } finally {
    metrics.close()
    vi.restoreAllMocks()
  }
})
