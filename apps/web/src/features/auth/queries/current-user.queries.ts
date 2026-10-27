import { queryOptions } from "@tanstack/react-query"
import { queryConfig } from "@/lib/query/query.config"
import { httpStatus } from "@/lib/api/http-status"
import type { QueryClient } from "@tanstack/react-query"

import { apiClient } from "@/lib/api/client"
import { currentUserSchema } from "@/lib/api/contracts"
import { privateQueryKeyPrefix } from "@/lib/query/query-keys"

export class AuthenticationRequiredError extends Error {}

export const currentUserQueryOptions = queryOptions({
  queryKey: [...privateQueryKeyPrefix, "auth", "current-user"],
  queryFn: async ({ signal }) => {
    const { data, response } = await apiClient.GET("/api/me", { signal })

    if (
      response.status === httpStatus.unauthorized ||
      response.status === httpStatus.forbidden
    ) {
      throw new AuthenticationRequiredError("Authentication required")
    }

    if (!response.ok || !data) {
      throw new Error("Unable to load the authenticated user")
    }

    return currentUserSchema.parse(data)
  },
  retry: false,
  staleTime: queryConfig.staleTimeMs,
})

export function loadCurrentUserForProtectedRoute(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    ...currentUserQueryOptions,
    staleTime: 0,
  })
}
