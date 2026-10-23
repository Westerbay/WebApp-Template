import { currentUserSchema } from "@workspace/contracts/identity"
import { createZodDto } from "nestjs-zod"

export class CurrentUserDto extends createZodDto(currentUserSchema) {}
