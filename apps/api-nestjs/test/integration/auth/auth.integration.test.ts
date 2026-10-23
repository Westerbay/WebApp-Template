import { spawnSync } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { createDatabase, schema } from "@workspace/database"
import { eq } from "drizzle-orm"
import request from "supertest"
import { createApiApp } from "../../../src/app.js"
import {
  app,
  cookieHeader,
  database,
  dispatcher,
  email,
  latestMailUrl,
  origin,
  password,
  post,
} from "../../support/auth.harness.js"

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL!
let cookie = ""
let verificationUrl = ""

describe("real HTTP auth with isolated PostgreSQL and Mailpit", () => {
  it("creates both deterministic auth fixtures without sessions", async () => {
    const fixtures = await database.db.query.user.findMany({
      where: (user, { inArray }) =>
        inArray(user.email, [
          "verified@example.test",
          "unverified@example.test",
        ]),
    })
    expect(fixtures).toHaveLength(2)
    expect(
      fixtures.find((fixture) => fixture.email === "verified@example.test")
        ?.emailVerified
    ).toBe(true)
    expect(
      fixtures.find((fixture) => fixture.email === "unverified@example.test")
        ?.emailVerified
    ).toBe(false)
    expect(await database.db.query.session.findMany()).toEqual([])
    expect(await database.db.query.verification.findMany()).toEqual([])
  })

  it("rolls back the complete fixture replacement when an insert fails", async () => {
    const verified = await database.db.query.user.findFirst({
      where: eq(schema.user.email, "verified@example.test"),
    })
    const unverified = await database.db.query.user.findFirst({
      where: eq(schema.user.email, "unverified@example.test"),
    })
    if (!verified || !unverified) throw new Error("Missing auth fixtures")

    await database.db
      .delete(schema.user)
      .where(eq(schema.user.id, unverified.id))
    await database.db.insert(schema.user).values({
      id: unverified.id,
      email: "fixture-id-blocker@example.test",
      emailVerified: true,
      name: "Non-fixture blocker",
    })
    await database.db
      .update(schema.user)
      .set({ emailVerified: false })
      .where(eq(schema.user.id, verified.id))
    await database.db
      .update(schema.account)
      .set({ password: "rollback-proof-hash" })
      .where(eq(schema.account.userId, verified.id))

    const failed = spawnSync(process.execPath, ["dist/cli/seed.js", "--all"], {
      cwd: ".",
      env: process.env,
      encoding: "utf8",
    })
    expect(failed.status).not.toBe(0)
    expect(
      await database.db.query.user.findFirst({
        where: eq(schema.user.id, verified.id),
      })
    ).toMatchObject({ emailVerified: false })
    expect(
      await database.db.query.account.findFirst({
        where: eq(schema.account.userId, verified.id),
      })
    ).toMatchObject({ password: "rollback-proof-hash" })
    expect(
      await database.db.query.user.findFirst({
        where: eq(schema.user.id, unverified.id),
      })
    ).toMatchObject({ email: "fixture-id-blocker@example.test" })

    await database.db
      .delete(schema.user)
      .where(eq(schema.user.id, unverified.id))
    const restore = spawnSync(process.execPath, ["dist/cli/seed.js", "--all"], {
      cwd: ".",
      env: process.env,
      encoding: "utf8",
    })
    expect(restore.status, restore.stderr).toBe(0)
  })

  it("restores recognized fixtures deterministically with --all", async () => {
    const verified = await database.db.query.user.findFirst({
      where: eq(schema.user.email, "verified@example.test"),
    })
    const unverified = await database.db.query.user.findFirst({
      where: eq(schema.user.email, "unverified@example.test"),
    })
    if (!verified || !unverified) throw new Error("Missing auth fixtures")

    await database.db
      .update(schema.user)
      .set({ emailVerified: false, name: "Compte vérifié" })
      .where(eq(schema.user.id, verified.id))
    await database.db
      .update(schema.user)
      .set({ emailVerified: true })
      .where(eq(schema.user.id, unverified.id))
    await database.db
      .update(schema.account)
      .set({ password: "existing-password-hash" })
      .where(eq(schema.account.userId, verified.id))

    const rerun = spawnSync(process.execPath, ["dist/cli/seed.js", "--all"], {
      cwd: ".",
      env: process.env,
      encoding: "utf8",
    })
    expect(rerun.status, rerun.stderr).toBe(0)

    const restoredVerified = await database.db.query.user.findFirst({
      where: eq(schema.user.email, verified.email),
    })
    const restoredUnverified = await database.db.query.user.findFirst({
      where: eq(schema.user.email, unverified.email),
    })
    const account = await database.db.query.account.findFirst({
      where: eq(schema.account.userId, restoredVerified!.id),
    })
    expect(restoredVerified?.emailVerified).toBe(true)
    expect(restoredUnverified?.emailVerified).toBe(false)
    expect(restoredVerified?.id).toBe(verified.id)
    expect(account?.password).not.toBe("existing-password-hash")
    const restoredLogin = await post("/sign-in/email", {
      email: verified.email,
      password,
    })
    expect(restoredLogin.status).toBe(200)
    expect(
      (
        await post("/sign-out", {}).set(
          "Cookie",
          cookieHeader(restoredLogin.headers["set-cookie"])
        )
      ).status
    ).toBe(200)
    expect(await database.db.query.session.findMany()).toEqual([])
    expect(await database.db.query.verification.findMany()).toEqual([])
  })
  it("requires email verification, captures French mail, then requires explicit login", async () => {
    const signup = await post("/sign-up/email", {
      email,
      password,
      name: "Camille",
      callbackURL: `${origin}/adresse-confirmee`,
    })
    expect(signup.status).toBe(200)
    expect(signup.headers["set-cookie"]).toBeUndefined()
    expect((await post("/sign-in/email", { email, password })).status).toBe(403)
    verificationUrl = await latestMailUrl()
    const url = new URL(verificationUrl)
    const verification = await request(app.getHttpServer()).get(
      `${url.pathname}${url.search}`
    )
    expect(verification.status).toBe(302)
    expect(verification.headers.location).toBe(`${origin}/adresse-confirmee`)
    const login = await post("/sign-in/email", { email, password })
    expect(login.status).toBe(200)
    cookie = cookieHeader(login.headers["set-cookie"])
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(
      (await request(app.getHttpServer()).get("/api/me").set("Cookie", cookie))
        .status
    ).toBe(200)
  })
  it("keeps two authenticated identities isolated by their session cookies", async () => {
    const secondEmail = "second-user@example.test"
    expect(
      (
        await post("/sign-up/email", {
          email: secondEmail,
          password,
          name: "Morgan",
          callbackURL: `${origin}/adresse-confirmee`,
        })
      ).status
    ).toBe(200)
    const secondVerificationUrl = new URL(await latestMailUrl())
    expect(
      (
        await request(app.getHttpServer()).get(
          `${secondVerificationUrl.pathname}${secondVerificationUrl.search}`
        )
      ).status
    ).toBe(302)
    const secondLogin = await post("/sign-in/email", {
      email: secondEmail,
      password,
    })
    expect(secondLogin.status).toBe(200)
    const secondCookie = cookieHeader(secondLogin.headers["set-cookie"])

    const [firstIdentity, secondIdentity] = await Promise.all([
      request(app.getHttpServer()).get("/api/me").set("Cookie", cookie),
      request(app.getHttpServer()).get("/api/me").set("Cookie", secondCookie),
    ])
    expect(firstIdentity.body.email).toBe(email)
    expect(secondIdentity.body.email).toBe(secondEmail)
    expect(firstIdentity.body.id).not.toBe(secondIdentity.body.id)
  })
  it("keeps email requests non-enumerating and rejects external callback URLs", async () => {
    const known = await post("/request-password-reset", {
      email,
      redirectTo: `${origin}/nouveau-mot-de-passe`,
    })
    const unknown = await post("/request-password-reset", {
      email: "unknown@example.test",
      redirectTo: `${origin}/nouveau-mot-de-passe`,
    })
    expect(known.status).toBe(unknown.status)
    expect(known.body).toEqual(unknown.body)
    const knownResend = await post("/send-verification-email", { email })
    const unknownResend = await post("/send-verification-email", {
      email: "unknown@example.test",
    })
    expect(knownResend.status).toBe(unknownResend.status)
    expect(knownResend.body).toEqual(unknownResend.body)
    expect(
      (
        await post("/request-password-reset", {
          email,
          redirectTo: "https://evil.test/reset",
        })
      ).status
    ).toBe(403)
  })
  it("resets the password once and revokes old sessions", async () => {
    await database.db
      .update(schema.rateLimit)
      .set({ lastRequest: Date.now() - 60_000 })
    await dispatcher.drain()
    const resetUrl = new URL(await latestMailUrl())
    const redirect = await request(app.getHttpServer()).get(
      `${resetUrl.pathname}${resetUrl.search}`
    )
    const token = new URL(
      redirect.headers.location ?? "http://invalid.test"
    ).searchParams.get("token")
    expect(token).toBeTruthy()
    const nextPassword = "New-Local-Only-2026!"
    expect(
      (await post("/reset-password", { token, newPassword: nextPassword }))
        .status
    ).toBe(200)
    expect(
      (await post("/reset-password", { token, newPassword: password })).status
    ).toBe(400)
    expect(
      (await request(app.getHttpServer()).get("/api/me").set("Cookie", cookie))
        .status
    ).toBe(401)
    expect((await post("/sign-in/email", { email, password })).status).toBe(401)
    const login = await post("/sign-in/email", {
      email,
      password: nextPassword,
    })
    expect(login.status).toBe(200)
    cookie = cookieHeader(login.headers["set-cookie"])
    expect((await post("/sign-out", {}).set("Cookie", cookie)).status).toBe(200)
    expect(
      (await request(app.getHttpServer()).get("/api/me").set("Cookie", cookie))
        .status
    ).toBe(401)
  })
  it("rejects expired reset tokens", async () => {
    await post("/request-password-reset", {
      email,
      redirectTo: `${origin}/nouveau-mot-de-passe`,
    })
    const resetUrl = new URL(await latestMailUrl())
    await database.db
      .update(schema.verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
    expect(
      (
        await request(app.getHttpServer()).get(
          `${resetUrl.pathname}${resetUrl.search}`
        )
      ).headers.location
    ).toContain("error=")
  })
  it("rejects verification at its expiry boundary", async () => {
    const url = new URL(verificationUrl)
    const token = url.searchParams.get("token")
    const payload = token?.split(".")[1]
    if (!payload) throw new Error("Missing test verification token")
    const expiration = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    ).exp
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(expiration * 1000)
    try {
      const response = await request(app.getHttpServer()).get(
        `${url.pathname}${url.search}`
      )
      expect(response.status).toBe(302)
      expect(response.headers.location).toContain("error=")
    } finally {
      vi.useRealTimers()
    }
  })
  it("rejects expired sessions and hostile origins", async () => {
    await database.db
      .update(schema.rateLimit)
      .set({ lastRequest: Date.now() - 60000 })
    const login = await post("/sign-in/email", {
      email,
      password: "New-Local-Only-2026!",
    })
    expect(login.status).toBe(200)
    const sessionCookie = cookieHeader(login.headers["set-cookie"])
    expect(
      (
        await post("/sign-out", {})
          .set("Cookie", sessionCookie)
          .set("Origin", "https://evil.test")
      ).status
    ).toBe(403)
    await database.db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
    expect(
      (
        await request(app.getHttpServer())
          .get("/api/me")
          .set("Cookie", sessionCookie)
      ).status
    ).toBe(401)
  })
  it("rate limits parallel attempts even when forwarded client headers change", async () => {
    await database.db
      .update(schema.rateLimit)
      .set({ lastRequest: Date.now() - 60000 })
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        post("/send-verification-email", { email: "unknown@example.test" })
          .set("x-forwarded-for", `192.0.2.${index}`)
          .set("x-auth-client-ip", `198.51.100.${index}`)
      )
    )
    expect(
      responses.filter((response) => response.status === 429).length
    ).toBeGreaterThanOrEqual(3)
    expect(responses.filter((response) => response.status === 200).length).toBe(
      5
    )
    await database.db
      .update(schema.rateLimit)
      .set({ lastRequest: Date.now() - 60000 })
    expect(
      (
        await post("/send-verification-email", {
          email: "unknown@example.test",
        })
      ).status
    ).toBe(200)
  })
  it("keeps liveness available when a real database client is unavailable", async () => {
    const unavailableDatabase = createDatabase(databaseUrl)
    await unavailableDatabase.close()
    const healthApp = await createApiApp({
      authHandler: (_request, response) => response.sendStatus(404),
      getSession: () => Promise.resolve(null),
      listUsers: async () => ({ items: [], nextCursor: null }),
      databaseReady: unavailableDatabase.ready,
      readinessTimeoutMs: 20,
      allowedOrigin: origin,
    })
    await healthApp.init()
    try {
      await request(healthApp.getHttpServer())
        .get("/health/live")
        .expect(200, { status: "ok" })
      await request(healthApp.getHttpServer()).get("/health/ready").expect(503)
    } finally {
      await healthApp.close()
    }
  })
  it("cleans fixture-owned reset tokens without touching another user", async () => {
    const fixture = await database.db.query.user.findFirst({
      where: eq(schema.user.email, "verified@example.test"),
    })
    const otherUser = await database.db.query.user.findFirst({
      where: eq(schema.user.email, email),
    })
    if (!fixture || !otherUser) throw new Error("Missing cleanup test users")

    expect(
      (
        await post("/request-password-reset", {
          email: fixture.email,
          redirectTo: `${origin}/nouveau-mot-de-passe`,
        })
      ).status
    ).toBe(200)
    expect(
      await database.db.query.verification.findFirst({
        where: eq(schema.verification.value, fixture.id),
      })
    ).toBeTruthy()

    const unrelatedVerificationId = "cleanup-unrelated-verification"
    await database.db.insert(schema.verification).values({
      id: unrelatedVerificationId,
      identifier: "cleanup-unrelated",
      value: otherUser.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const cleanup = spawnSync(
      process.execPath,
      ["dist/cli/seed.js", "--scenario", "auth", "--clean"],
      { cwd: ".", env: process.env, encoding: "utf8" }
    )
    expect(cleanup.status, cleanup.stderr).toBe(0)
    expect(
      await database.db.query.user.findMany({
        where: (user, { inArray }) =>
          inArray(user.email, [
            "verified@example.test",
            "unverified@example.test",
          ]),
      })
    ).toEqual([])
    expect(
      await database.db.query.verification.findFirst({
        where: eq(schema.verification.value, fixture.id),
      })
    ).toBeUndefined()
    expect(
      await database.db.query.verification.findFirst({
        where: eq(schema.verification.id, unrelatedVerificationId),
      })
    ).toBeTruthy()
    await database.db
      .delete(schema.verification)
      .where(eq(schema.verification.id, unrelatedVerificationId))

    const collisionId = "reserved-address-collision"
    await database.db.insert(schema.user).values({
      id: collisionId,
      email: "verified@example.test",
      name: "Real local account",
      emailVerified: true,
    })
    const refusedSeed = spawnSync(
      process.execPath,
      ["dist/cli/seed.js", "--all"],
      { cwd: ".", env: process.env, encoding: "utf8" }
    )
    expect(refusedSeed.status).not.toBe(0)
    expect(
      await database.db.query.user.findFirst({
        where: eq(schema.user.id, collisionId),
      })
    ).toMatchObject({ name: "Real local account" })
    expect(
      await database.db.query.user.findFirst({
        where: eq(schema.user.id, otherUser.id),
      })
    ).toBeTruthy()
    await database.db.delete(schema.user).where(eq(schema.user.id, collisionId))
  })
})
