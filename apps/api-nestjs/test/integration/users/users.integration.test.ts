import { usersPageSchema } from "@workspace/contracts/users"
import request from "supertest"
import { expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { schema } from "@workspace/database"
import { createApiApp } from "../../../src/app.js"
import { createListUsers } from "../../../src/modules/users/list-users.js"
import { database } from "../../support/auth.harness.js"

it("traverses PostgreSQL users without duplicates and continues after a cursor row is deleted", async () => {
  const firstUserId = "pagination-test-001"
  const ids = [firstUserId, "pagination-test-002", "pagination-test-003"]
  await database.db.insert(schema.user).values(
    ids.map((id) => ({
      id,
      name: "Même nom",
      email: `${id}@example.test`,
      emailVerified: true,
    }))
  )
  const app = await createApiApp({
    authHandler: (_request, response) => response.sendStatus(404),
    getSession: async () => ({
      user: {
        id: firstUserId,
        name: "Test",
        email: "pagination-test-001@example.test",
        emailVerified: true,
      },
      session: { id: "pagination-test-session" },
    }),
    databaseReady: database.ready,
    listUsers: createListUsers(database.db),
  })
  await app.init()
  try {
    const first = await request(app.getHttpServer())
      .get("/api/users?limit=1&cursor=pagination-test-000")
      .expect(200)
    expect(first.body.items.map((user: { id: string }) => user.id)).toEqual([
      ids[0],
    ])
    expect(first.body.nextCursor).toBe(ids[0])
    await database.db.delete(schema.user).where(eq(schema.user.id, firstUserId))
    const next = await request(app.getHttpServer())
      .get(`/api/users?limit=1&cursor=${first.body.nextCursor}`)
      .expect(200)
    expect(next.body.items.map((user: { id: string }) => user.id)).toEqual([
      ids[1],
    ])

    const expected = await database.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .orderBy(schema.user.id)
    const seen: Array<string> = []
    let cursor: string | null = null
    do {
      const response: request.Response = await request(app.getHttpServer())
        .get("/api/users")
        .query({ limit: 7, ...(cursor ? { cursor } : {}) })
        .expect(200)
      const page = usersPageSchema.parse(response.body)
      expect(page.items.length).toBeLessThanOrEqual(7)
      expect(
        page.items.every(
          (user: object) =>
            Object.keys(user).sort().join(",") === "email,emailVerified,id,name"
        )
      ).toBe(true)
      seen.push(...page.items.map((user) => user.id))
      cursor = page.nextCursor
    } while (cursor !== null)
    expect(seen).toEqual(expected.map((user) => user.id))
    expect(new Set(seen).size).toBe(seen.length)
  } finally {
    await app.close()
    for (const id of ids)
      await database.db.delete(schema.user).where(eq(schema.user.id, id))
  }
})

it("searches names and emails case-insensitively with literal wildcards and filtered cursors", async () => {
  const firstUser = {
    id: "search-test-001",
    name: "Needle Search One",
    email: "first@users-search.example.test",
    emailVerified: true,
  }
  const fixtures = [
    firstUser,
    {
      id: "search-test-002",
      name: "Needle Search Two",
      email: "second@users-search.example.test",
      emailVerified: true,
    },
    {
      id: "search-test-003",
      name: "100% literal_under\\slash",
      email: "literal@users-search.example.test",
      emailVerified: true,
    },
    {
      id: "search-test-004",
      name: "1000 literalXunder/slash",
      email: "other@users-search.example.test",
      emailVerified: true,
    },
  ]
  await database.db.insert(schema.user).values(fixtures)
  const app = await createApiApp({
    authHandler: (_request, response) => response.sendStatus(404),
    getSession: async () => ({
      user: firstUser,
      session: { id: "search-test-session" },
    }),
    databaseReady: database.ready,
    listUsers: createListUsers(database.db),
  })
  await app.init()
  try {
    const first = await request(app.getHttpServer())
      .get("/api/users")
      .query({ search: "  nEeDlE sEaRcH  ", limit: 1 })
      .expect(200)
    expect(usersPageSchema.parse(first.body)).toEqual({
      items: [fixtures[0]],
      nextCursor: firstUser.id,
    })
    const next = await request(app.getHttpServer())
      .get("/api/users")
      .query({
        search: "needle search",
        limit: 1,
        cursor: first.body.nextCursor,
      })
      .expect(200)
    expect(usersPageSchema.parse(next.body)).toEqual({
      items: [fixtures[1]],
      nextCursor: null,
    })
    const email = await request(app.getHttpServer())
      .get("/api/users")
      .query({ search: "FIRST@USERS-SEARCH" })
      .expect(200)
    expect(usersPageSchema.parse(email.body).items).toEqual([fixtures[0]])
    for (const search of ["%", "_", "\\"]) {
      const literal = await request(app.getHttpServer())
        .get("/api/users")
        .query({ search })
        .expect(200)
      expect(usersPageSchema.parse(literal.body).items).toEqual([fixtures[2]])
    }
    const empty = await request(app.getHttpServer())
      .get("/api/users")
      .query({ search: "no-user-matches-this-search" })
      .expect(200)
    expect(usersPageSchema.parse(empty.body)).toEqual({
      items: [],
      nextCursor: null,
    })
  } finally {
    await app.close()
    for (const fixture of fixtures)
      await database.db
        .delete(schema.user)
        .where(eq(schema.user.id, fixture.id))
  }
})
