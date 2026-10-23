import { Catch, HttpException, HttpStatus, Logger } from "@nestjs/common"
import { ZodSerializationException, ZodValidationException } from "nestjs-zod"
import { z } from "zod"
import { getRequestId } from "./request-context.js"
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common"
import type { Request, Response } from "express"
import type { ApiError } from "@workspace/contracts/common"

type ErrorDetails = ReadonlyArray<Readonly<{ code: string; path: string }>>
type ErrorResponse = Readonly<{ code: string; message: string }>

const ERROR_RESPONSES: {
  readonly [status: number]: ErrorResponse | undefined
} = {
  [HttpStatus.BAD_REQUEST]: {
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: "UNAUTHORIZED",
    message: "Authentication required",
  },
  [HttpStatus.FORBIDDEN]: {
    code: "FORBIDDEN",
    message: "Access forbidden",
  },
  [HttpStatus.NOT_FOUND]: {
    code: "NOT_FOUND",
    message: "Resource not found",
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: "RATE_LIMITED",
    message: "Too many requests",
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: "SERVICE_UNAVAILABLE",
    message: "Service unavailable",
  },
}

const INTERNAL_ERROR_RESPONSE: ErrorResponse = {
  code: "INTERNAL_ERROR",
  message: "Internal server error",
}

// Read only public issue metadata from the adapter's unknown error shape.
const validationErrorSchema = z.object({
  issues: z.array(
    z.object({
      code: z.string(),
      path: z.array(z.union([z.string(), z.number()])),
    })
  ),
})

function getValidationDetails(exception: ZodValidationException): ErrorDetails {
  const error = validationErrorSchema.safeParse(exception.getZodError())
  if (!error.success) return []

  return error.data.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.join("."),
  }))
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const request = context.getRequest<Request>()
    const response = context.getResponse<Response>()
    const requestId = getRequestId(request)

    if (exception instanceof ZodSerializationException) {
      this.logger.error("A controller returned an invalid response")
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        ...INTERNAL_ERROR_RESPONSE,
        requestId,
      })
      return
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const errorName =
        exception instanceof Error ? exception.constructor.name : "UnknownError"
      this.logger.error(`Unhandled application error: ${errorName}`)
    }

    const errorResponse = ERROR_RESPONSES[status] ?? INTERNAL_ERROR_RESPONSE
    const body: ApiError = {
      ...errorResponse,
      requestId,
    }

    if (exception instanceof ZodValidationException) {
      body.details = getValidationDetails(exception)
    }

    response.status(status).json(body)
  }
}
