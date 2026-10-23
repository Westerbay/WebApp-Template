import { inArray, or } from "drizzle-orm"

import { schema } from "@workspace/database"
import type { Database } from "@workspace/database"
import type { AuthFixtureStore, PreparedAuthFixture } from "./scenario.js"

interface FixtureDeleteStore {
  delete: Database["delete"]
}

export function createDrizzleAuthFixtureStore(
  database: Database
): AuthFixtureStore {
  const removeFixtures = async (
    transaction: FixtureDeleteStore,
    fixtureIds: ReadonlyArray<string>
  ) => {
    if (fixtureIds.length === 0) return
    // Better Auth 1.7 stores password-reset ownership in `value` as the
    // user id; email-verification links are stateless signed JWTs.
    await transaction
      .delete(schema.verification)
      .where(inArray(schema.verification.value, [...fixtureIds]))
    await transaction
      .delete(schema.user)
      .where(inArray(schema.user.id, [...fixtureIds]))
  }

  return {
    async findReserved(reservations) {
      const reservedAccounts = await database.query.account.findMany({
        columns: { userId: true },
        where: inArray(schema.account.id, [...reservations.accountIds]),
      })
      return database.query.user.findMany({
        where: or(
          inArray(schema.user.email, [...reservations.emails]),
          inArray(schema.user.id, [
            ...reservations.userIds,
            ...reservedAccounts.map(({ userId }) => userId),
          ])
        ),
        with: { accounts: true },
      })
    },
    async replaceRecognized(fixtureIds, fixtures) {
      await database.transaction(async (transaction) => {
        await removeFixtures(transaction, fixtureIds)
        await transaction.insert(schema.user).values(
          fixtures.map(({ id, name, email, emailVerified }) => ({
            id,
            name,
            email,
            emailVerified,
          }))
        )
        await transaction
          .insert(schema.account)
          .values(fixtures.map(toCredentialAccount))
      })
    },
    async removeRecognized(fixtureIds) {
      await database.transaction((transaction) =>
        removeFixtures(transaction, fixtureIds)
      )
    },
  }
}

function toCredentialAccount(fixture: PreparedAuthFixture) {
  return {
    id: fixture.accountId,
    accountId: fixture.id,
    providerId: "credential",
    userId: fixture.id,
    password: fixture.passwordHash,
  }
}
