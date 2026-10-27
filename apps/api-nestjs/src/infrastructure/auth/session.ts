import type { CurrentUser } from "@workspace/contracts/identity"

export type AuthSession = Readonly<{
  user: Readonly<CurrentUser>
  session: Readonly<{
    id: string
  }>
}>

export type GetSession = (headers: Headers) => Promise<AuthSession | null>

interface SessionSource {
  getSession: (input: { headers: Headers }) => Promise<AuthSession | null>
}

export function createSessionReader(source: SessionSource): GetSession {
  return async (headers) => {
    const session = await source.getSession({ headers })
    if (!session) return null
    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      },
      session: { id: session.session.id },
    }
  }
}
