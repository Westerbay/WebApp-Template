import { expect, it, vi } from "vitest"

import { createShutdown } from "../../../../src/infrastructure/lifecycle/shutdown.js"
import type { ShutdownEvent } from "../../../../src/infrastructure/lifecycle/shutdown.js"

it("closes every resource in order once when shutdown is requested twice", async () => {
  const order: Array<string> = []
  const events: Array<ShutdownEvent> = []
  const shutdown = createShutdown(
    [
      {
        name: "server",
        close: vi.fn(() => {
          order.push("server")
          return Promise.resolve()
        }),
      },
      {
        name: "email",
        close: vi.fn(() => {
          order.push("email")
          return Promise.reject(new Error("private provider detail"))
        }),
      },
      {
        name: "database",
        close: vi.fn(() => {
          order.push("database")
          return Promise.resolve()
        }),
      },
    ],
    (event) => events.push(event)
  )

  const first = shutdown()
  const second = shutdown()
  await expect(first).rejects.toThrow("API_SHUTDOWN_FAILED")
  await expect(second).rejects.toThrow("API_SHUTDOWN_FAILED")
  expect(order).toEqual(["server", "email", "database"])
  expect(events).toEqual([
    { event: "api.stopping" },
    { event: "api.shutdown_failed", resource: "email" },
  ])
})

it("continues asynchronous cleanup after a synchronous closer throws", async () => {
  const failure = new Error("metrics cleanup failed")
  const closeDatabase = vi.fn(() => Promise.resolve())
  const shutdown = createShutdown(
    [
      {
        name: "metrics-registry",
        close: () => {
          throw failure
        },
      },
      { name: "database", close: closeDatabase },
    ],
    vi.fn()
  )
  await expect(shutdown()).rejects.toMatchObject({
    message: "API_SHUTDOWN_FAILED",
    errors: [failure],
  })
  expect(closeDatabase).toHaveBeenCalledOnce()
})
