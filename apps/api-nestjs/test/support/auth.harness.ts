import { createServer } from "node:net"
import { afterAll, beforeAll, expect } from "vitest"
import { createDatabase } from "@workspace/database"
import { createSmtpSender, getEmailConfig } from "@workspace/email"
import request from "supertest"
import { createAuthHandler } from "../../src/infrastructure/auth/http-handler.js"
import { createListUsers } from "../../src/modules/users/list-users.js"
import { createApiApp } from "../../src/app.js"
import { getEnv } from "../../src/config/env.js"
import { createAuth } from "../../src/infrastructure/auth/auth.js"
import { AuthEmailDispatcher } from "../../src/infrastructure/email/auth-email-dispatcher.js"
import type { INestApplication } from "@nestjs/common"

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL
if (
  !databaseUrl ||
  !process.env.AUTH_TEST_OWNED?.startsWith("webapp-template-code004-test-")
)
  throw new Error(
    "Use pnpm test:integration or pnpm test:e2e: isolated owned services required"
  )
const target = new URL(databaseUrl)
if (
  target.hostname !== "127.0.0.1" ||
  target.pathname !== "/webapp_template_auth_test"
)
  throw new Error("Refusing unverified test database")

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No test port")
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

export const database = createDatabase(databaseUrl)
export const webPort = await freePort()
const apiPort = await freePort()
export const origin = `http://127.0.0.1:${webPort}`
export const api = `http://127.0.0.1:${apiPort}`
export const email = "journey@example.test"
export const password = "Local-Only-Auth-2026!"
const events: Array<string> = []
const sender = createSmtpSender(
  getEmailConfig({
    APP_ENV: "test",
    EMAIL_MODE: "capture",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: process.env.AUTH_TEST_SMTP_PORT,
  })
)
export const dispatcher = new AuthEmailDispatcher(sender, (event) => {
  events.push(event.event)
})
const auth = createAuth(
  database.db,
  getEnv({
    APP_ENV: "test",
    BETTER_AUTH_URL: api,
    WEB_URL: origin,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: "isolated-test-secret-not-for-production-2026",
  }),
  dispatcher
)
export let app: INestApplication

export function cookieHeader(value: string | Array<string> | undefined) {
  if (!value) throw new Error("Missing session cookie")
  return Array.isArray(value) ? value.join("; ") : value
}

export async function latestMailUrl() {
  await dispatcher.drain()
  expect(events.at(-1)).toBe("email.accepted")
  const listing = await fetch(
    `${process.env.AUTH_TEST_MAILPIT_URL}/api/v1/messages`
  ).then((response) => response.json())
  const message = await fetch(
    `${process.env.AUTH_TEST_MAILPIT_URL}/api/v1/message/${listing.messages[0].ID}`
  ).then((response) => response.json())
  const match = message.Text.match(/https?:\/\/[^\s<>]+/)
  if (!match) throw new Error("No action link in captured mail")
  return match[0]
}

export const post = (path: string, body: object) =>
  request(app.getHttpServer())
    .post(`/api/auth${path}`)
    .set("Origin", origin)
    .send(body)

beforeAll(async () => {
  app = await createApiApp({
    authHandler: createAuthHandler(auth),
    getSession: (headers) => auth.api.getSession({ headers }),
    listUsers: createListUsers(database.db),
    databaseReady: database.ready,
    allowedOrigin: origin,
  })
  await app.listen(apiPort, "127.0.0.1")
})

afterAll(async () => {
  await app.close()
  await dispatcher.close()
  await database.close()
})
