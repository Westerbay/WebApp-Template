import { z } from "zod"

// Express supplies additional metadata; only the route template is needed here.
const routeSchema = z.object({ path: z.string() })
const unmatchedRoute = "unmatched"
const catchAllPaths = new Set(["{/*splat}", "/*splat", "*"])
const observedRoutes = new WeakMap<HttpRouteRequest, string>()

export interface HttpRouteRequest {
  url?: string
  originalUrl?: string
  baseUrl?: string
  route?: unknown
}

// Server adapters supply registered templates, never concrete request paths.
export function setHttpRoute(
  request: HttpRouteRequest,
  template: string
): void {
  observedRoutes.set(request, template)
}

export function getHttpRoute(request: HttpRouteRequest): string {
  const observed = observedRoutes.get(request)
  if (observed) return observed
  const route = routeSchema.safeParse(request.route)
  if (!route.success || catchAllPaths.has(route.data.path))
    return unmatchedRoute
  return (request.baseUrl ?? "") + route.data.path
}
