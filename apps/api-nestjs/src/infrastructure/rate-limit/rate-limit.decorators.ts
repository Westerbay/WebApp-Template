import { applyDecorators } from "@nestjs/common"
import { ApiTooManyRequestsResponse } from "@nestjs/swagger"
import { SkipThrottle, Throttle, seconds } from "@nestjs/throttler"

import { ApiErrorDto } from "../http/api-error.dto.js"
import { API_THROTTLER_NAME } from "./rate-limit.config.js"

export type RateLimitOptions = Readonly<{
  limit: number
  windowSeconds: number
}>

export function RateLimit(options: RateLimitOptions) {
  return applyDecorators(
    Throttle({
      [API_THROTTLER_NAME]: {
        limit: options.limit,
        ttl: seconds(options.windowSeconds),
      },
    }),
    ApiTooManyRequestsResponse({
      description: "Too many requests",
      type: ApiErrorDto,
    })
  )
}

export function SkipRateLimit() {
  return SkipThrottle({ [API_THROTTLER_NAME]: true })
}
