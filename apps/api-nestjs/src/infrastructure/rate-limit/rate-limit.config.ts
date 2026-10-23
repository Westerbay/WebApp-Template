import { seconds } from "@nestjs/throttler"
import type { ThrottlerModuleOptions } from "@nestjs/throttler"

export const apiRateLimitConfig = {
  default: {
    limit: 120,
    windowSeconds: 60,
  },
  currentUser: {
    limit: 30,
    windowSeconds: 60,
  },
}

export const API_THROTTLER_NAME = "api"

export const apiThrottlerOptions = {
  throttlers: [
    {
      name: API_THROTTLER_NAME,
      limit: apiRateLimitConfig.default.limit,
      ttl: seconds(apiRateLimitConfig.default.windowSeconds),
    },
  ],
} satisfies ThrottlerModuleOptions
