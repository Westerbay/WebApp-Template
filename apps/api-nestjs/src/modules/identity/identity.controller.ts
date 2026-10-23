import { Controller, Get, HttpStatus } from "@nestjs/common"
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { ZodResponse } from "nestjs-zod"

import { CurrentUser } from "../../infrastructure/auth/guard.js"
import { ApiErrorDto } from "../../infrastructure/http/api-error.dto.js"
import { apiRateLimitConfig } from "../../infrastructure/rate-limit/rate-limit.config.js"
import { RateLimit } from "../../infrastructure/rate-limit/rate-limit.decorators.js"
import { CurrentUserDto } from "./identity.dto.js"
import type { AuthSession } from "../../infrastructure/auth/session.js"

@Controller("api")
export class IdentityController {
  @Get("me")
  @RateLimit(apiRateLimitConfig.currentUser)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({
    description: "Authentication required",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: "Verified email required",
    type: ApiErrorDto,
  })
  @ZodResponse({ status: HttpStatus.OK, type: CurrentUserDto })
  me(@CurrentUser() user: AuthSession["user"]): CurrentUserDto {
    return user
  }
}
