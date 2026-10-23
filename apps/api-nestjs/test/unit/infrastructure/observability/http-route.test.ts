import { describe, expect, it } from "vitest"
import {
  getHttpRoute,
  setHttpRoute,
} from "../../../../src/infrastructure/observability/http-route.js"

describe("HTTP route normalization", () => {
  it("uses mounted route templates without including parameters or query strings", () => {
    expect(
      getHttpRoute({
        originalUrl: "/api/users/private-user?token=private-token",
        baseUrl: "/api",
        route: { path: "/users/:id", methods: { get: true }, stack: [] },
      })
    ).toBe("/api/users/:id")
  })

  it.each([
    undefined,
    null,
    "private-path",
    {},
    { path: null },
    { path: 123 },
    { path: ["/users/:id", "/users"] },
    { path: /private-user/ },
  ])("uses a bounded fallback for unsupported route metadata (%j)", (route) => {
    expect(
      getHttpRoute({ url: "/unknown/private-user?token=private-token", route })
    ).toBe("unmatched")
  })

  it.each(["{/*splat}", "/*splat", "*"])(
    "groups catch-all routes under the same fallback (%s)",
    (path) => {
      expect(
        getHttpRoute({ url: "/unknown/private-user", route: { path } })
      ).toBe("unmatched")
    }
  )

  it("uses the adapter template ahead of Express metadata", () => {
    const request = {
      originalUrl: "/api/auth/inspect/private-token?token=private-query",
      route: { path: "/*splat" },
    }
    setHttpRoute(request, "/api/auth/inspect/:token")
    expect(getHttpRoute(request)).toBe("/api/auth/inspect/:token")
    expect(getHttpRoute({ originalUrl: request.originalUrl })).toBe("unmatched")
  })
})
