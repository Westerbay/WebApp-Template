import type { CurrentUser } from "@workspace/contracts/identity"
import type { CursorPage } from "@workspace/contracts/pagination"
import type { UsersQuery } from "@workspace/contracts/users"

export const LIST_USERS = Symbol("LIST_USERS")
export type ListUsers = (query: UsersQuery) => Promise<CursorPage<CurrentUser>>
