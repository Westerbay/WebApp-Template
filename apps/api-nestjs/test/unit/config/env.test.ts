import { expect, it } from "vitest"
import { getEnv } from "../../../src/config/env.js"

it("rejects insecure deployed auth origins without leaking configuration values", () => {
  const values = {
    APP_ENV: "production",
    WEB_URL: "http://private-web.invalid",
    BETTER_AUTH_URL: "http://private-api.invalid",
    BETTER_AUTH_SECRET: "private-secret-not-for-production-use",
    DATABASE_URL: "postgresql://user:private-db-password@localhost/test",
  }
  expect(() => getEnv(values)).toThrow("WEB_URL")
  expect(() => getEnv(values)).not.toThrow("private")
})
