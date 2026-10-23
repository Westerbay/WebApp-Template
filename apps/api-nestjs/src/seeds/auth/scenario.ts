import { createDemoAuthFixtures } from "./fixtures.js"
import type { SeedScenario } from "../seed.js"

export const AUTH_FIXTURE_PASSWORD = "Local-Only-Auth-2026!"
export type AuthFixture = Readonly<{
  accountId: string
  email: string
  emailVerified: boolean
  id: string
  name: string
  password: string
}>
export interface PreparedAuthFixture {
  readonly accountId: string
  readonly email: string
  readonly emailVerified: boolean
  readonly id: string
  readonly name: string
  readonly passwordHash: string
}
export type ExistingAuthFixture = Readonly<{
  id: string
  email: string
  name: string
  accounts: ReadonlyArray<
    Readonly<{
      id: string
      accountId: string
      providerId: string
      password: string | null
    }>
  >
}>
export interface AuthFixtureStore {
  findReserved: (
    reservations: Readonly<{
      accountIds: ReadonlyArray<string>
      emails: ReadonlyArray<string>
      userIds: ReadonlyArray<string>
    }>
  ) => Promise<ReadonlyArray<ExistingAuthFixture>>
  replaceRecognized: (
    ids: ReadonlyArray<string>,
    fixtures: ReadonlyArray<PreparedAuthFixture>
  ) => Promise<void>
  removeRecognized: (ids: ReadonlyArray<string>) => Promise<void>
}

export type HashFixturePassword = (password: string) => Promise<string>

export const AUTH_FIXTURES: ReadonlyArray<AuthFixture> = [
  {
    id: "seed-auth-user-verified",
    accountId: "seed-auth-account-verified",
    email: "verified@example.test",
    emailVerified: true,
    name: "Compte vérifié",
    password: AUTH_FIXTURE_PASSWORD,
  },
  {
    id: "seed-auth-user-unverified",
    accountId: "seed-auth-account-unverified",
    email: "unverified@example.test",
    emailVerified: false,
    name: "Compte non vérifié",
    password: AUTH_FIXTURE_PASSWORD,
  },
  ...createDemoAuthFixtures(AUTH_FIXTURE_PASSWORD),
]

function recognizedFixture(user: ExistingAuthFixture, fixture: AuthFixture) {
  const account = user.accounts[0]
  return (
    user.id === fixture.id &&
    user.email === fixture.email &&
    user.name === fixture.name &&
    user.accounts.length === 1 &&
    account?.id === fixture.accountId &&
    account.providerId === "credential" &&
    account.accountId === user.id &&
    typeof account.password === "string" &&
    account.password.length > 0
  )
}

async function preflight(store: AuthFixtureStore) {
  const existing = await store.findReserved({
    accountIds: AUTH_FIXTURES.map(({ accountId }) => accountId),
    emails: AUTH_FIXTURES.map(({ email }) => email),
    userIds: AUTH_FIXTURES.map(({ id }) => id),
  })
  const recognized: Array<string> = []
  for (const user of existing) {
    const fixture = AUTH_FIXTURES.find(({ email }) => email === user.email)
    if (!fixture || !recognizedFixture(user, fixture)) {
      throw new Error(`Reserved seed address collision: ${user.email}`)
    }
    recognized.push(user.id)
  }
  return recognized
}

export function createAuthSeedScenario(
  store: AuthFixtureStore,
  hashPassword: HashFixturePassword
): SeedScenario {
  return {
    name: "auth",
    async prepareSeed() {
      const recognized = await preflight(store)
      const fixtures: Array<PreparedAuthFixture> = []
      // Bound memory usage: Better Auth's password hashes are memory-intensive.
      for (const { password, ...fixture } of AUTH_FIXTURES) {
        fixtures.push({
          ...fixture,
          passwordHash: await hashPassword(password),
        })
      }
      return () => store.replaceRecognized(recognized, fixtures)
    },
    async prepareClean() {
      const recognized = await preflight(store)
      return () => store.removeRecognized(recognized)
    },
  }
}
