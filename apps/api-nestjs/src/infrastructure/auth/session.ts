import type { CurrentUser } from "@workspace/contracts/identity"

export type AuthSession = Readonly<{
  user: Readonly<CurrentUser>
  session: Readonly<{
    id: string
  }>
}>

export type GetSession = (headers: Headers) => Promise<AuthSession | null>
