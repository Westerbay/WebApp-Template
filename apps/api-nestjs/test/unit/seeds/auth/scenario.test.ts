import { describe, expect, it, vi } from "vitest"

import {
  AUTH_FIXTURES,
  AUTH_FIXTURE_PASSWORD,
  createAuthSeedScenario,
} from "../../../../src/seeds/auth/scenario.js"
import type {
  AuthFixtureStore,
  ExistingAuthFixture,
  PreparedAuthFixture,
} from "../../../../src/seeds/auth/scenario.js"
import type { SeedScenario } from "../../../../src/seeds/seed.js"

const hashPassword = vi.fn((password: string) =>
  Promise.resolve(`hash:${password}`)
)

function existingFixture(index: number): ExistingAuthFixture {
  const fixture = AUTH_FIXTURES[index]!
  return {
    id: fixture.id,
    email: fixture.email,
    name: fixture.name,
    accounts: [
      {
        id: fixture.accountId,
        accountId: fixture.id,
        providerId: "credential",
        password: "old-hash",
      },
    ],
  }
}

function createStore(initial: ReadonlyArray<ExistingAuthFixture> = []) {
  const users = new Map(initial.map((user) => [user.email, user]))
  const removeRecognized = vi.fn((ids: ReadonlyArray<string>) => {
    for (const [email, user] of users)
      if (ids.includes(user.id)) users.delete(email)
    return Promise.resolve()
  })
  const replaceRecognized = vi.fn(
    async (
      ids: ReadonlyArray<string>,
      fixtures: ReadonlyArray<PreparedAuthFixture>
    ) => {
      await removeRecognized(ids)
      for (const fixture of fixtures) {
        users.set(fixture.email, {
          id: fixture.id,
          email: fixture.email,
          name: fixture.name,
          accounts: [
            {
              id: fixture.accountId,
              accountId: fixture.id,
              providerId: "credential",
              password: fixture.passwordHash,
            },
          ],
        })
      }
    }
  )
  const store: AuthFixtureStore = {
    findReserved: ({ accountIds, emails, userIds }) =>
      Promise.resolve(
        [...users.values()].filter(
          (user) =>
            emails.includes(user.email) ||
            userIds.includes(user.id) ||
            user.accounts.some(({ id }) => accountIds.includes(id))
        )
      ),
    replaceRecognized,
    removeRecognized,
  }
  return { removeRecognized, replaceRecognized, store, users }
}

async function runPrepared(scenario: SeedScenario, clean = false) {
  const operation = await (clean
    ? scenario.prepareClean()
    : scenario.prepareSeed())
  await operation()
}

describe("auth seed scenario", () => {
  it("hashes every password before atomically replacing fixtures", async () => {
    const fixtureStore = createStore()
    await runPrepared(createAuthSeedScenario(fixtureStore.store, hashPassword))
    expect(fixtureStore.replaceRecognized).toHaveBeenCalledTimes(1)
    const [, prepared] = fixtureStore.replaceRecognized.mock.calls[0]!
    expect(prepared).toHaveLength(AUTH_FIXTURES.length)
    expect(prepared[0]).toMatchObject({
      id: AUTH_FIXTURES[0]!.id,
      accountId: AUTH_FIXTURES[0]!.accountId,
      passwordHash: `hash:${AUTH_FIXTURE_PASSWORD}`,
    })
  })

  it("replaces recognized fixtures to restore deterministic values", async () => {
    const fixtureStore = createStore(
      AUTH_FIXTURES.map((_, index) => existingFixture(index))
    )
    await runPrepared(createAuthSeedScenario(fixtureStore.store, hashPassword))
    expect(fixtureStore.replaceRecognized).toHaveBeenCalledWith(
      AUTH_FIXTURES.map(({ id }) => id),
      expect.any(Array)
    )
  })

  it.each([
    { ...existingFixture(0), id: "lookalike-user" },
    {
      ...existingFixture(0),
      accounts: [
        { ...existingFixture(0).accounts[0]!, id: "lookalike-account" },
      ],
    },
    { ...existingFixture(0), email: "different@example.test" },
    {
      id: "different-user",
      email: "different@example.test",
      name: "Different",
      accounts: [existingFixture(0).accounts[0]!],
    },
  ])("refuses lookalike fixture ownership before mutation", async (user) => {
    const fixtureStore = createStore([user])
    await expect(
      createAuthSeedScenario(fixtureStore.store, hashPassword).prepareSeed()
    ).rejects.toThrow("collision")
    expect(fixtureStore.replaceRecognized).not.toHaveBeenCalled()
    expect(fixtureStore.removeRecognized).not.toHaveBeenCalled()
  })

  it("does not mutate when password preparation fails", async () => {
    const fixtureStore = createStore(
      AUTH_FIXTURES.map((_, index) => existingFixture(index))
    )
    const failingHash = vi
      .fn<(password: string) => Promise<string>>()
      .mockResolvedValueOnce("hash")
      .mockRejectedValueOnce(new Error("hash failed"))
    await expect(
      createAuthSeedScenario(fixtureStore.store, failingHash).prepareSeed()
    ).rejects.toThrow("hash failed")
    expect(fixtureStore.replaceRecognized).not.toHaveBeenCalled()
    expect(fixtureStore.removeRecognized).not.toHaveBeenCalled()
  })

  it("cleans recognized fixtures while preserving other users", async () => {
    const fixtureStore = createStore([
      existingFixture(0),
      existingFixture(1),
      { id: "other", email: "other@example.test", name: "Other", accounts: [] },
    ])
    await runPrepared(
      createAuthSeedScenario(fixtureStore.store, hashPassword),
      true
    )
    expect([...fixtureStore.users.keys()]).toEqual(["other@example.test"])
  })
})
