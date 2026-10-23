import { cursorPaginationConstraints } from "@workspace/contracts/pagination/constraints"
import { describe, expect, it } from "vitest"
import { cursorPaginationSchema } from "@workspace/contracts/pagination"
import { createCursorPage } from "../../../../src/infrastructure/pagination/cursor-page.js"

it("bounds pagination parameters and rejects empty cursors", () => {
  expect(cursorPaginationSchema.parse({})).toEqual({
    limit: cursorPaginationConstraints.defaultLimit,
  })
  expect(cursorPaginationSchema.parse({ limit: "2", cursor: "abc" })).toEqual({
    limit: 2,
    cursor: "abc",
  })
  for (const limit of [
    cursorPaginationConstraints.minLimit - 1,
    cursorPaginationConstraints.maxLimit + 1,
    1.5,
    "no",
    "",
  ]) {
    expect(cursorPaginationSchema.safeParse({ limit }).success).toBe(false)
  }
  expect(cursorPaginationSchema.safeParse({ cursor: "" }).success).toBe(false)
  expect(
    cursorPaginationSchema.safeParse({
      cursor: "x".repeat(cursorPaginationConstraints.maxCursorLength + 1),
    }).success
  ).toBe(false)
})

describe("cursor pages", () => {
  it("uses the last visible row as the cursor and excludes the lookahead", () => {
    expect(createCursorPage(["a", "b", "c"], 2, (id) => id)).toEqual({
      items: ["a", "b"],
      nextCursor: "b",
    })
  })
  it("ends empty, partial and exactly full final pages", () => {
    for (const rows of [[], ["a"], ["a", "b"]]) {
      expect(createCursorPage(rows, 2, (id) => id)).toEqual({
        items: rows,
        nextCursor: null,
      })
    }
  })
})

it("supports a falsy last item in reusable pages", () => {
  expect(createCursorPage([0, 1], 1, String)).toEqual({
    items: [0],
    nextCursor: "0",
  })
})
