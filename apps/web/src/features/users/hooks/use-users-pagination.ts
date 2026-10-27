import { useState } from "react"
import { usersTableConfig } from "../users.config"
import { usersQueryOptions } from "../queries/users.queries"
import { useCursorInfiniteQuery } from "@/lib/query/use-cursor-infinite-query"
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value"
import type { ChangeEvent } from "react"

interface UsersNavigation {
  search: string
  pageIndex: number
}

export function useUsersPagination() {
  const pageSize = usersTableConfig.pageSize
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(
    search.trim(),
    usersTableConfig.searchDebounceMs
  )
  const searchPending = search.trim() !== debouncedSearch
  const query = useCursorInfiniteQuery(
    usersQueryOptions(pageSize, debouncedSearch)
  )
  const [navigation, setNavigation] = useState<UsersNavigation>({
    search: debouncedSearch,
    pageIndex: 0,
  })
  const requestedPageIndex =
    navigation.search === debouncedSearch ? navigation.pageIndex : 0
  const pages = query.data?.pages
  const pageCount = pages?.length ?? 0
  const pageIndex = Math.min(requestedPageIndex, Math.max(0, pageCount - 1))
  const hasCachedNextPage = pageIndex + 1 < pageCount
  const canGoPrevious = pageIndex > 0 && !query.isFetching && !searchPending
  const canGoNext =
    (hasCachedNextPage || query.hasNextPage) &&
    !query.isFetching &&
    !searchPending

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value)
    setNavigation({ search: event.target.value.trim(), pageIndex: 0 })
  }

  const setPageIndex = (nextPageIndex: number) => {
    const updateNavigation = (current: UsersNavigation) => {
      if (current.search !== debouncedSearch) return current
      return { search: debouncedSearch, pageIndex: nextPageIndex }
    }
    setNavigation(updateNavigation)
  }

  const handlePreviousPage = () => {
    if (!canGoPrevious) return
    setPageIndex(pageIndex - 1)
  }

  const loadNextPage = async (nextPageIndex: number) => {
    const result = await query.fetchNextPage()
    if (!result.isError && (result.data?.pages.length ?? 0) > nextPageIndex) {
      setPageIndex(nextPageIndex)
    }
  }

  const handleNextPage = async () => {
    if (!canGoNext) return
    const nextPageIndex = pageIndex + 1
    if (hasCachedNextPage) {
      setPageIndex(nextPageIndex)
      return
    }
    await loadNextPage(nextPageIndex)
  }

  const handleRetry = async () => {
    if (query.isFetching || searchPending) return
    if (query.isFetchNextPageError) {
      await loadNextPage(pageCount)
      return
    }
    await query.refetch()
  }

  return {
    query,
    search,
    searchPending,
    handleSearchChange,
    pageIndex,
    pageSize,
    pageCount,
    pageNumber: pageIndex + 1,
    canGoPrevious,
    canGoNext,
    handlePreviousPage,
    handleNextPage,
    handleRetry,
  }
}
