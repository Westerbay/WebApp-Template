import { usersPageSchema, usersQuerySchema } from "@workspace/contracts/users"
import { createZodDto } from "nestjs-zod"

export class UsersQueryDto extends createZodDto(usersQuerySchema) {}
export class UsersPageDto extends createZodDto(usersPageSchema) {}
