import { randomUUID } from "node:crypto"
import { LoggerModule } from "nestjs-pino"
import { pinoHttp } from "pino-http"
import { getHttpRoute } from "../observability/http-route.js"
import type { HttpRouteRequest } from "../observability/http-route.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { DynamicModule } from "@nestjs/common"
import type { RequestHandler } from "express"
import type { Logger } from "pino"
import type { Options as PinoHttpOptions, ReqId } from "pino-http"

function requestId(request: IncomingMessage, response: ServerResponse) {
  const id = typeof request.id === "string" ? request.id : randomUUID()
  response.setHeader("x-request-id", id)
  return id
}

interface HttpRequestLogInput extends HttpRouteRequest {
  id: ReqId
  method: string
  url: string
  raw?: HttpRouteRequest
}

interface HttpResponseLogInput {
  statusCode: number
}

function serializeRequest(request: HttpRequestLogInput) {
  const path = getHttpRoute(request.raw ?? request)
  return { requestId: request.id, method: request.method, path }
}

function serializeResponse(response: HttpResponseLogInput) {
  return { status: response.statusCode }
}

function serializeError(error: object) {
  return { type: error.constructor.name }
}

function httpOptions(logger: Logger): PinoHttpOptions {
  return {
    logger,
    genReqId: requestId,
    quietResLogger: true,
    customSuccessObject: (
      request,
      _response,
      details: Record<string, unknown>
    ) => ({ ...details, route: getHttpRoute(request), request }),
    customErrorObject: (
      request,
      _response,
      _error,
      details: Record<string, unknown>
    ) => ({ ...details, route: getHttpRoute(request), request }),
    customAttributeKeys: {
      req: "request",
      res: "response",
      responseTime: "durationMs",
    },
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
      err: serializeError,
    },
  }
}

interface HttpLogging {
  readonly middleware: RequestHandler
  readonly module: DynamicModule
}

export function createHttpLogging(logger: Logger): HttpLogging {
  const options = httpOptions(logger)
  const contextOptions = {
    ...options,
    autoLogging: false,
  }

  return {
    middleware: pinoHttp(options),
    module: LoggerModule.forRoot({ pinoHttp: contextOptions }),
  }
}
