import { apiErrorSchema } from "@workspace/contracts/common"
import { createZodDto } from "nestjs-zod"

export class ApiErrorDto extends createZodDto(apiErrorSchema) {}
