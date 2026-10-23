import type { CursorPage } from "@workspace/contracts/pagination"

// Fetch limit + 1 rows in the same stable order used by the cursor predicate.
export function createCursorPage<T>(
  rows: Array<T>,
  limit: number,
  cursorOf: (item: T) => string
): CursorPage<T> {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      rows.length > limit && last !== undefined ? cursorOf(last) : null,
  }
}
