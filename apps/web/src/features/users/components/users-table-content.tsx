import { flexRender } from "@tanstack/react-table"
import { users_title, users_empty } from "@workspace/i18n/messages"
import type {
  Cell,
  Header,
  HeaderGroup,
  Row,
  Table,
} from "@tanstack/react-table"
import type { CurrentUser } from "@/lib/api/contracts"

function renderHeader(header: Header<CurrentUser, unknown>) {
  return (
    <th key={header.id} scope="col" className="px-5 py-3 font-medium">
      {header.isPlaceholder
        ? null
        : flexRender(header.column.columnDef.header, header.getContext())}
    </th>
  )
}

function renderHeaderGroup(group: HeaderGroup<CurrentUser>) {
  return <tr key={group.id}>{group.headers.map(renderHeader)}</tr>
}

function renderCell(cell: Cell<CurrentUser, unknown>) {
  return (
    <td key={cell.id} className="px-5 py-3">
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </td>
  )
}

function renderRow(row: Row<CurrentUser>) {
  return (
    <tr key={row.id} className="border-b last:border-b-0">
      {row.getVisibleCells().map(renderCell)}
    </tr>
  )
}

type UsersTableContentProps = {
  table: Table<CurrentUser>
  titleId: string
  pending: boolean
}

export function UsersTableContent({
  table,
  titleId,
  pending,
}: UsersTableContentProps) {
  const rows = table.getRowModel().rows
  return (
    <section
      className="overflow-x-auto"
      aria-labelledby={titleId}
      tabIndex={0}
      aria-busy={pending}
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{users_title()}</caption>
        <thead className="border-y bg-muted/50">
          {table.getHeaderGroups().map(renderHeaderGroup)}
        </thead>
        <tbody>
          {rows.map(renderRow)}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={table.getVisibleLeafColumns().length}
                className="px-5 py-8 text-center text-muted-foreground"
              >
                {users_empty()}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
