import { Controller, Get, HttpStatus, Inject, Query } from "@nestjs/common"
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger"
import { ZodResponse } from "nestjs-zod"
import { ApiErrorDto } from "../../infrastructure/http/api-error.dto.js"
import { LIST_USERS } from "./users.types.js"
import { UsersPageDto, UsersQueryDto } from "./users.dto.js"
import type { ListUsers } from "./users.types.js"

@Controller("api/users")
export class UsersController {
  constructor(@Inject(LIST_USERS) private readonly listUsers: ListUsers) {}

  @Get()
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({
    description: "Authentication required",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: "Verified email required",
    type: ApiErrorDto,
  })
  @ApiBadRequestResponse({
    description: "Invalid pagination or search parameters",
    type: ApiErrorDto,
  })
  @ZodResponse({ status: HttpStatus.OK, type: UsersPageDto })
  list(@Query() query: UsersQueryDto): Promise<UsersPageDto> {
    return this.listUsers(query)
  }
}
