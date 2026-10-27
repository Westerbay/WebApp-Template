import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query"
import { expect, it } from "vitest"
import { cursorInfiniteQueryOptions } from "@/lib/query/use-cursor-infinite-query"
import type { InfiniteData } from "@tanstack/react-query"
import type { CursorPage } from "@workspace/contracts/pagination/types"

it("preserves native select options without asserting page parameter types", async () => {
  const client = new QueryClient()
  async function fetchPage() {
    return { items: ["first"], nextCursor: null }
  }
  function selectItems(
    data: InfiniteData<CursorPage<string>, string | undefined>
  ) {
    return data.pages.flatMap((page) => page.items)
  }
  const options = cursorInfiniteQueryOptions({
    queryKey: ["private", "selected-pagination"],
    queryFn: fetchPage,
    select: selectItems,
  })
  const observer = new InfiniteQueryObserver(client, options)
  const result = await observer.fetchNextPage()
  expect(result.data).toEqual(["first"])
  observer.destroy()
  client.clear()
})
