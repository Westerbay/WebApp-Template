import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common"
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
} from "@nestjs/swagger"

import { Public } from "../../infrastructure/auth/guard.js"
import { ApiErrorDto } from "../../infrastructure/http/api-error.dto.js"
import { SkipRateLimit } from "../../infrastructure/rate-limit/rate-limit.decorators.js"
import {
  DATABASE_READINESS,
  READINESS_TIMEOUT,
  waitForReadiness,
} from "./readiness.js"
import type { DatabaseReadiness } from "./readiness.js"

class HealthResponseDto {
  @ApiProperty({ enum: ["ok"] })
  status!: "ok"
}

@Controller("health")
@SkipRateLimit()
export class HealthController {
  constructor(
    @Inject(DATABASE_READINESS)
    private readonly databaseReady: DatabaseReadiness,
    @Inject(READINESS_TIMEOUT) private readonly readinessTimeoutMs: number
  ) {}

  @Public()
  @Get("live")
  live(): HealthResponseDto {
    return { status: "ok" }
  }

  @Public()
  @Get("ready")
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto })
  async ready(): Promise<HealthResponseDto> {
    try {
      await waitForReadiness(this.databaseReady, this.readinessTimeoutMs)
      return { status: "ok" }
    } catch {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      })
    }
  }
}
