import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { schema } from "@workspace/database"
import type { Database } from "@workspace/database"

/** Keep admission and increment in the same PostgreSQL row lock. */
export function createRateLimitStore(
  db: Database,
  longestWindowSeconds: number
) {
  let lastPrune = 0
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const now = Date.now()
      const cutoff = now - rule.window * 1000
      if (now - lastPrune >= longestWindowSeconds * 1000) {
        lastPrune = now
        await db
          .delete(schema.rateLimit)
          .where(
            sql`${schema.rateLimit.lastRequest} < ${now - longestWindowSeconds * 1000}`
          )
      }
      const table = schema.rateLimit
      const rows = await db
        .insert(table)
        .values({ id: randomUUID(), key, count: 1, lastRequest: now })
        .onConflictDoUpdate({
          target: table.key,
          set: {
            count: sql`case when ${table.lastRequest} <= ${cutoff} then 1 else ${table.count} + 1 end`,
            lastRequest: now,
          },
          setWhere: sql`${table.lastRequest} <= ${cutoff} or ${table.count} < ${rule.max}`,
        })
        .returning({ count: table.count })
      if (rows.length) return { allowed: true, retryAfter: null }
      const existing = await db.query.rateLimit.findFirst({
        where: (rate, { eq }) => eq(rate.key, key),
      })
      const retryAfter = Math.max(
        1,
        Math.ceil(
          ((existing?.lastRequest ?? now) + rule.window * 1000 - now) / 1000
        )
      )
      return { allowed: false, retryAfter }
    },
  }
}
