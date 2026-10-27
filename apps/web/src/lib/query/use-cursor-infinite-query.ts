import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query"
import type { CursorPage } from "@workspace/contracts/pagination/types"
import type {
  InfiniteData,
  GetPreviousPageParamFunction,
  QueryKey,
  QueryObserverOptions,
} from "@tanstack/react-query"

export interface CursorQueryOptions<
  T,
  TData = InfiniteData<CursorPage<T>, string | undefined>,
> extends QueryObserverOptions<
  CursorPage<T>,
  Error,
  TData,
  InfiniteData<CursorPage<T>, string | undefined>,
  QueryKey,
  string | undefined
> {
  getPreviousPageParam?: GetPreviousPageParamFunction<
    string | undefined,
    CursorPage<T>
  >
  experimental_prefetchInRender?: boolean
  subscribed?: boolean
  maxPages?: number
}

function getNextPageCursor<T>(page: CursorPage<T>): string | undefined {
  return page.nextCursor ?? undefined
}

export function cursorInfiniteQueryOptions<
  T,
  TData = InfiniteData<CursorPage<T>, string | undefined>,
>(options: CursorQueryOptions<T, TData>) {
  return infiniteQueryOptions<
    CursorPage<T>,
    Error,
    TData,
    QueryKey,
    string | undefined
  >({
    ...options,
    initialPageParam: undefined,
    getNextPageParam: getNextPageCursor<T>,
  })
}

export function useCursorInfiniteQuery<
  T,
  TData = InfiniteData<CursorPage<T>, string | undefined>,
>(options: CursorQueryOptions<T, TData>) {
  return useInfiniteQuery(cursorInfiniteQueryOptions(options))
}
