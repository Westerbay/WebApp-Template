import { toNodeHandler } from "better-auth/node"
import { addRoute, createRouter, findRoute } from "rou3"
import { z } from "zod"
import { setHttpRoute } from "../observability/http-route.js"
import type { BetterAuthOptions } from "better-auth"
import type { RequestHandler } from "express"

interface AuthHttpSource {
  api: Readonly<Record<string, unknown>>
  handler: (request: Request) => Promise<Response>
  options: BetterAuthOptions
}

const endpointSchema = z.object({
  path: z.string().startsWith("/"),
  options: z.object({
    method: z.union([z.string(), z.array(z.string())]).optional(),
    metadata: z.object({ SERVER_ONLY: z.boolean().optional() }).optional(),
  }),
})

export function createAuthHandler(auth: AuthHttpSource): RequestHandler {
  const router = createRouter<string>()
  for (const endpoint of Object.values(auth.api)) {
    // Better Auth endpoints are callable objects; Zod objects accept plain objects.
    const metadata = endpointSchema.safeParse(Object.assign({}, endpoint))
    if (!metadata.success) continue
    const { path, options } = metadata.data
    if (
      options.metadata?.SERVER_ONLY ||
      auth.options.disabledPaths?.includes(path)
    )
      continue
    const methods = options.method
    const registeredMethods = Array.isArray(methods) ? methods : [methods]
    for (const method of registeredMethods) addRoute(router, method, path, path)
  }
  const handler = toNodeHandler(auth)

  return (request, response) => {
    const path = new URL(request.originalUrl, "http://localhost").pathname
    const prefix = request.baseUrl
    const route = findRoute(router, request.method, path.slice(prefix.length))
    setHttpRoute(request, prefix + (route?.data ?? "/*"))
    return handler(request, response)
  }
}
