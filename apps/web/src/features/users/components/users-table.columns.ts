import {
  users_name,
  users_email,
  users_status,
  users_verified,
  users_unverified,
} from "@workspace/i18n/messages"
import type { CellContext, ColumnDef } from "@tanstack/react-table"
import type { CurrentUser } from "@/lib/api/contracts"

function renderEmailVerification({ row }: CellContext<CurrentUser, unknown>) {
  return row.original.emailVerified ? users_verified() : users_unverified()
}

export function getUsersColumns(): Array<ColumnDef<CurrentUser>> {
  return [
    { accessorKey: "name", header: users_name() },
    { accessorKey: "email", header: users_email() },
    {
      accessorKey: "emailVerified",
      header: users_status(),
      cell: renderEmailVerification,
    },
  ]
}
