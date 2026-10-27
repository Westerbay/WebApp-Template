import { expect, it } from "vitest"
import { createSessionReader } from "../../../../src/infrastructure/auth/session.js"

it("projects only application identity fields from the provider session", async () => {
  const headers = new Headers({ cookie: "fixture-session" })
  const providerSession = {
    user: {
      id: "user-1",
      name: "Alice",
      email: "alice@example.test",
      emailVerified: true,
      internalNote: "private",
    },
    session: {
      id: "session-1",
      token: "private-token",
      ipAddress: "192.0.2.1",
    },
  }
  const reader = createSessionReader({
    getSession: async (input) => {
      expect(input.headers).toBe(headers)
      return providerSession
    },
  })
  expect(await reader(headers)).toEqual({
    user: {
      id: "user-1",
      name: "Alice",
      email: "alice@example.test",
      emailVerified: true,
    },
    session: { id: "session-1" },
  })
})

it("preserves the anonymous session and provider failure outcomes", async () => {
  const anonymous = createSessionReader({ getSession: async () => null })
  expect(await anonymous(new Headers())).toBeNull()
  const error = new Error("provider unavailable")
  const failed = createSessionReader({
    getSession: async () => {
      throw error
    },
  })
  await expect(failed(new Headers())).rejects.toBe(error)
})
