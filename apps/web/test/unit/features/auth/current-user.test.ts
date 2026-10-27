import { QueryClient } from "@tanstack/react-query"
import { httpStatus } from "@/lib/api/http-status"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import {
  AuthenticationRequiredError,
  currentUserQueryOptions,
  loadCurrentUserForProtectedRoute,
} from "@/features/auth/queries/current-user.queries"

const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/lib/api/client", () => ({
  apiClient: { GET: getCurrentUser },
}))

afterEach(() => {
  getCurrentUser.mockReset()
})

describe("identity transitions", () => {
  it("accepts a valid identity with additive server fields and forwards cancellation", async () => {
    const queryClient = new QueryClient()
    const identity = {
      id: "user",
      name: "Alice",
      email: "alice@example.test",
      emailVerified: true,
    }
    getCurrentUser.mockResolvedValue({
      response: new Response(),
      data: { ...identity, newServerField: "additional" },
    })
    try {
      await expect(
        queryClient.fetchQuery(currentUserQueryOptions)
      ).resolves.toEqual(identity)
      expect(getCurrentUser).toHaveBeenCalledWith("/api/me", {
        signal: expect.any(AbortSignal),
      })
    } finally {
      queryClient.clear()
    }
  })

  it("rejects an invalid successful identity response before caching it", async () => {
    const queryClient = new QueryClient()
    getCurrentUser.mockResolvedValue({
      response: new Response(),
      data: {
        id: "user",
        name: "Alice",
        email: "alice@example.test",
        emailVerified: "true",
      },
    })

    try {
      await expect(
        queryClient.fetchQuery(currentUserQueryOptions)
      ).rejects.toBeInstanceOf(ZodError)
      expect(
        queryClient.getQueryData(currentUserQueryOptions.queryKey)
      ).toBeUndefined()
    } finally {
      queryClient.clear()
    }
  })

  it("checks a fresh cached identity with the API before entering a protected route", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(currentUserQueryOptions.queryKey, {
      id: "revoked-user",
      name: "Revoked user",
      email: "revoked@example.test",
      emailVerified: true,
    })
    getCurrentUser.mockResolvedValue({
      response: new Response(null, { status: httpStatus.unauthorized }),
    })

    await expect(
      loadCurrentUserForProtectedRoute(queryClient)
    ).rejects.toBeInstanceOf(AuthenticationRequiredError)

    expect(getCurrentUser).toHaveBeenCalledOnce()
    queryClient.clear()
  })

  it("preserves forbidden-session handling before response validation", async () => {
    const queryClient = new QueryClient()
    getCurrentUser.mockResolvedValue({
      response: new Response(null, { status: httpStatus.forbidden }),
      data: { error: "unverified" },
    })
    try {
      await expect(
        loadCurrentUserForProtectedRoute(queryClient)
      ).rejects.toBeInstanceOf(AuthenticationRequiredError)
    } finally {
      queryClient.clear()
    }
  })
})
