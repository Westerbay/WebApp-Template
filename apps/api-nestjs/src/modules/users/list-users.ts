import { and, asc, gt, ilike, or } from "drizzle-orm"
import { schema } from "@workspace/database"
import { createCursorPage } from "../../infrastructure/pagination/cursor-page.js"
import type { Database } from "@workspace/database"
import type { CurrentUser } from "@workspace/contracts/identity"
import type { UsersQuery } from "@workspace/contracts/users"
import type { ListUsers } from "./users.types.js"

function escapeLikePattern(value: string) {
  // Treat SQL LIKE metacharacters as literal search text.
  return value.replace(/[\\%_]/g, "\\$&")
}

function getUserCursor(user: CurrentUser) {
  return user.id
}

export function createListUsers(database: Database): ListUsers {
  const listUsers = async ({ cursor, limit, search }: UsersQuery) => {
    let searchFilter
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`
      searchFilter = or(
        ilike(schema.user.name, pattern),
        ilike(schema.user.email, pattern)
      )
    }
    let cursorFilter
    if (cursor !== undefined) cursorFilter = gt(schema.user.id, cursor)
    const rows = await database
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        emailVerified: schema.user.emailVerified,
      })
      .from(schema.user)
      .where(and(cursorFilter, searchFilter))
      .orderBy(asc(schema.user.id))
      .limit(limit + 1)
    return createCursorPage(rows, limit, getUserCursor)
  }

  return listUsers
}
