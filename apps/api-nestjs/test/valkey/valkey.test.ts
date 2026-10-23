import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import request from "supertest"
import { afterAll, beforeAll, expect, it } from "vitest"
import { createApiApp } from "../../src/app.js"
import { createValkey } from "../../src/infrastructure/valkey/valkey.js"
import { ValkeyRateLimitStore } from "../../src/infrastructure/rate-limit/valkey-rate-limit-store.js"
import type { ValkeyConnection } from "../../src/infrastructure/valkey/valkey.js"

const container = `webapp-template-valkey-test-${randomUUID()}`
const clients: Array<ValkeyConnection> = []
let owned = false
let url: string
const docker = (...args: Array<string>) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 90000 })

beforeAll(async () => {
  docker(
    "run",
    "--detach",
    "--name",
    container,
    "--publish",
    "127.0.0.1::6379",
    "valkey/valkey:8.1.3-alpine",
    "valkey-server",
    "--save",
    "",
    "--appendonly",
    "no",
    "--maxmemory-policy",
    "noeviction"
  )
  owned = true
  const address = docker("port", container, "6379/tcp").trim()
  if (!/^127\.0\.0\.1:\d+$/.test(address))
    throw new Error("Unexpected owned Valkey address")
  url = `redis://${address}`
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if (docker("exec", container, "valkey-cli", "ping").trim() === "PONG")
        return
    } catch {
      // Wait only for this suite's owned container.
    }
    await setTimeout(100)
  }
  throw new Error("Owned Valkey did not become ready")
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()))
  if (owned) docker("rm", "--force", container)
})

const connect = async () => {
  const connection = createValkey(url, () => {})
  clients.push(connection)
  await connection.client.connect()
  return connection
}

it("shares atomic quotas, expires blocks and isolates namespaces and routes", async () => {
  const first = await connect()
  const second = await connect()
  const storeA = new ValkeyRateLimitStore(first.client, "shared")
  const storeB = new ValkeyRateLimitStore(second.client, "shared")
  const hitA = () => storeA.increment("concurrent", 1000, 10, 100, "api")
  const hitB = () => storeB.increment("concurrent", 1000, 10, 100, "api")
  const hits = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? hitA() : hitB()
    )
  )
  expect(hits.filter((hit) => !hit.isBlocked)).toHaveLength(10)
  expect(
    (await storeA.increment("different-route", 1000, 10, 100, "api")).totalHits
  ).toBe(1)
  const isolated = new ValkeyRateLimitStore(second.client, "isolated")
  expect(
    (await isolated.increment("concurrent", 1000, 10, 100, "api")).isBlocked
  ).toBe(false)
  await setTimeout(150)
  expect((await hitA()).totalHits).toBe(1)
  await storeA.increment("expiration", 80, 10, 80, "api")
  await setTimeout(120)
  expect(
    (await storeB.increment("expiration", 80, 10, 80, "api")).totalHits
  ).toBe(1)
  await storeA.increment("rolling", 500, 2, 500, "api")
  await setTimeout(300)
  await storeB.increment("rolling", 500, 2, 500, "api")
  await setTimeout(300)
  expect(
    (await storeA.increment("rolling", 500, 2, 500, "api")).isBlocked
  ).toBe(false)
  expect(
    (await storeB.increment("rolling", 500, 2, 500, "api")).isBlocked
  ).toBe(true)
})

it("enforces one HTTP quota across two APIs and fails closed after a server outage", async () => {
  const first = await connect()
  const second = await connect()
  const createApp = async (connection: ValkeyConnection) => {
    const app = await createApiApp({
      authHandler: (_incoming, response) => response.sendStatus(204),
      getSession: async () => ({
        user: {
          id: "test",
          name: "Test",
          email: "test@example.test",
          emailVerified: true,
        },
        session: { id: "test" },
      }),
      listUsers: async () => ({ items: [], nextCursor: null }),
      databaseReady: connection.ready,
      rateLimitStorage: new ValkeyRateLimitStore(connection.client, "http"),
    })
    await app.init()
    return app
  }
  const appA = await createApp(first)
  const appB = await createApp(second)
  try {
    for (let index = 0; index < 30; index += 1) {
      const app = index % 2 === 0 ? appA : appB
      await request(app.getHttpServer()).get("/api/me").expect(200)
    }
    const blocked = await request(appB.getHttpServer())
      .get("/api/me")
      .expect(429)
    expect(Number(blocked.headers["retry-after-api"])).toBeGreaterThan(0)
    await request(appA.getHttpServer()).get("/api/users").expect(200)
    // Drop sockets while preserving the dynamic endpoint and quota state.
    docker(
      "exec",
      container,
      "valkey-cli",
      "CLIENT",
      "KILL",
      "TYPE",
      "normal",
      "SKIPME",
      "yes"
    )
    let recovered = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await Promise.all([first.ready(), second.ready()])
        recovered = true
        break
      } catch {
        await setTimeout(100)
      }
    }
    expect(recovered).toBe(true)
    await request(appB.getHttpServer()).get("/health/ready").expect(200)
    await request(appA.getHttpServer()).get("/api/me").expect(429)
    docker("stop", "--time", "0", container)
    await request(appA.getHttpServer()).get("/api/me").expect(503)
    await request(appB.getHttpServer()).get("/health/ready").expect(503)
    await request(appA.getHttpServer()).get("/health/live").expect(200)
    await request(appB.getHttpServer()).get("/api/auth/test").expect(204)
  } finally {
    await Promise.all([appA.close(), appB.close()])
  }
})
