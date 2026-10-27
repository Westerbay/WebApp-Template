import { useMemo } from "react"
import { getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { getUsersColumns } from "../components/users-table.columns"
import { useUsersPagination } from "./use-users-pagination"
import type { CurrentUser } from "@/lib/api/contracts"

const UNKNOWN_PAGE_COUNT = -1
const emptyUsers: Array<CurrentUser> = []

function getUserRowId(user: CurrentUser) {
  return user.id
}

export function useUsersTable() {
  const { pageIndex, pageSize, pageCount, ...pagination } = useUsersPagination()
  const columns = useMemo(getUsersColumns, [])
  const table = useReactTable({
    data: pagination.query.data?.pages[pageIndex]?.items ?? emptyUsers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: getUserRowId,
    manualPagination: true,
    // Cursor navigation does not know the total number of pages in advance.
    pageCount: pagination.query.hasNextPage ? UNKNOWN_PAGE_COUNT : pageCount,
    state: { pagination: { pageIndex, pageSize } },
  })
  return { ...pagination, table }
}
