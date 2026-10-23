import { createDatabase } from "@workspace/database"
import { afterEach, expect, it, vi } from "vitest"
import { createAuth } from "../../../../src/infrastructure/auth/auth.js"
import { getEnv } from "../../../../src/config/env.js"
import { AuthEmailDispatcher } from "../../../../src/infrastructure/email/auth-email-dispatcher.js"
import type { ApiEnv } from "../../../../src/config/env.js"

vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory")
  return {
    drizzleAdapter: () =>
      memoryAdapter({ user: [], account: [], session: [], verification: [] }),
  }
})

const database = createDatabase("postgres://unused:unused@127.0.0.1/unused")
const password = "password"
// SHA-1 suffix for the public test password, after the five-character prefix.
const suffix = "1E4C9B93F3F0682250B6CF8331B7EE68FD8"

afterEach(async () => {
  vi.unstubAllGlobals()
  await database.close()
})

const createTestAuth = (environment: ApiEnv["APP_ENV"]) => {
  const emails = new AuthEmailDispatcher(
    { send: () => Promise.resolve() },
    () => undefined
  )
  return createAuth(
    database.db,
    getEnv({
      APP_ENV: environment,
      BETTER_AUTH_SECRET: "local-test-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "https://api.example.test",
      WEB_URL: "https://web.example.test",
      DATABASE_URL: "postgres://unused:unused@127.0.0.1/unused",
    }),
    emails
  )
}

it.each(["staging", "production"] as const)(
  "rejects compromised signup passwords in %s without sending the full hash",
  async (environment) => {
    const fetch = vi.fn().mockResolvedValue(new Response(`${suffix}:42`))
    vi.stubGlobal("fetch", fetch)
    const auth = createTestAuth(environment)
    await expect(
      auth.api.signUpEmail({
        body: { name: "Test", email: "test@example.test", password },
      })
    ).rejects.toMatchObject({ body: { code: "PASSWORD_COMPROMISED" } })
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.pwnedpasswords.com/range/5BAA6"
    )
  }
)

it("accepts padding entries with zero occurrences and protects reset passwords", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(`${suffix}:0`))
  vi.stubGlobal("fetch", fetch)
  const auth = createTestAuth("production")
  const result = await auth.api.signUpEmail({
    body: { name: "Test", email: "test@example.test", password },
  })
  const context = await auth.$context
  const originalAccount = await context.internalAdapter.findCredentialAccount(
    result.user.id
  )
  await context.internalAdapter.createVerificationValue({
    identifier: "reset-password:test-token",
    value: result.user.id,
    expiresAt: new Date(Date.now() + 60_000),
  })
  fetch.mockResolvedValue(new Response(`${suffix}:42`))
  await expect(
    auth.api.resetPassword({
      body: { token: "test-token", newPassword: password },
    })
  ).rejects.toMatchObject({ body: { code: "PASSWORD_COMPROMISED" } })
  expect(
    await context.internalAdapter.findCredentialAccount(result.user.id)
  ).toEqual(originalAccount)
  await expect(
    auth.api.resetPassword({
      body: { token: "test-token", newPassword: password },
    })
  ).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } })
  await context.internalAdapter.createVerificationValue({
    identifier: "reset-password:fresh-token",
    value: result.user.id,
    expiresAt: new Date(Date.now() + 60_000),
  })
  fetch.mockResolvedValue(new Response(`${suffix}:0`))
  await expect(
    auth.api.resetPassword({
      body: { token: "fresh-token", newPassword: password },
    })
  ).resolves.toMatchObject({ status: true })
})

it("refuses password creation when the provider is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("", { status: 503 }))
  )
  const auth = createTestAuth("production")
  await expect(
    auth.api.signUpEmail({
      body: { name: "Test", email: "test@example.test", password },
    })
  ).rejects.toMatchObject({ status: "INTERNAL_SERVER_ERROR" })
})

it.each(["development", "test"] as const)(
  "keeps %s password creation offline",
  async (environment) => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error("Unexpected network call"))
    vi.stubGlobal("fetch", fetch)
    const auth = createTestAuth(environment)
    await expect(
      auth.api.signUpEmail({
        body: { name: "Test", email: "test@example.test", password },
      })
    ).resolves.toMatchObject({ user: { email: "test@example.test" } })
    expect(fetch).not.toHaveBeenCalled()
  }
)
