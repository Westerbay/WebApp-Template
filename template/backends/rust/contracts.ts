import type { z } from "zod"
import type { MeResponse } from "./responses.zod"

export {
  MeResponse as currentUserSchema,
  ListResponse as usersPageSchema,
} from "./responses.zod"
export type CurrentUser = z.infer<typeof MeResponse>
