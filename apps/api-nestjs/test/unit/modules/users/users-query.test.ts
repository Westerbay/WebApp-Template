import request from "supertest"
import { expect, it, vi } from "vitest"
import { usersSearchConstraints } from "@workspace/contracts/users/constraints"
import { createApiApp } from "../../../../src/app.js"

it("bounds and normalizes user search before calling the reader", async () => {
  const listUsers = vi.fn(async () => ({ items: [], nextCursor: null }))
  const app = await createApiApp({
    authHandler: (_request, response) => response.sendStatus(404),
    getSession: async () => ({
      user: {
        id: "search-reader",
        name: "Reader",
        email: "reader@example.test",
        emailVerified: true,
      },
      session: { id: "search-session" },
    }),
    databaseReady: async () => {},
    listUsers,
  })
  await app.init()
  try {
    await request(app.getHttpServer())
      .get("/api/users")
      .query({ search: "a".repeat(usersSearchConstraints.maxLength + 1) })
      .expect(400)
    await request(app.getHttpServer())
      .get("/api/users")
      .query({ search: ["Alice", "Bob"] })
      .expect(400)
    expect(listUsers).not.toHaveBeenCalled()
    await request(app.getHttpServer())
      .get("/api/users")
      .query({ search: "  Alice  ", limit: 2, cursor: "last-user" })
      .expect(200)
    expect(listUsers).toHaveBeenLastCalledWith({
      search: "Alice",
      limit: 2,
      cursor: "last-user",
    })
    await request(app.getHttpServer())
      .get("/api/users")
      .query({ search: "  " })
      .expect(200)
    expect(listUsers).toHaveBeenLastCalledWith({ search: "", limit: 20 })
  } finally {
    await app.close()
  }
})
