import { randomUUID } from "node:crypto"
import type { Request, RequestHandler } from "express"

const REQUEST_ID = Symbol("REQUEST_ID")

export const requestContext: RequestHandler = (request, response, next) => {
  const pinoRequestId = Reflect.get(request, "id")
  const requestId =
    typeof pinoRequestId === "string" ? pinoRequestId : randomUUID()
  Reflect.set(request, REQUEST_ID, requestId)
  request.headers["x-request-id"] = requestId
  response.setHeader("x-request-id", requestId)
  next()
}

export function getRequestId(request: Request): string {
  const requestId = Reflect.get(request, REQUEST_ID)
  return typeof requestId === "string" ? requestId : randomUUID()
}
