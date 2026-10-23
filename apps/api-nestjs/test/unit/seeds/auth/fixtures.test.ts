import { expect, it } from "vitest"
import { createDemoAuthFixtures } from "../../../../src/seeds/auth/fixtures.js"
import { authFixturesConfig } from "../../../../src/seeds/auth/fixtures.config.js"
import {
  AUTH_FIXTURES,
  AUTH_FIXTURE_PASSWORD,
} from "../../../../src/seeds/auth/scenario.js"
import type { AuthFixture } from "../../../../src/seeds/auth/scenario.js"

it("generates reproducible French profiles with unique reserved identities", () => {
  const fixtures = createDemoAuthFixtures(AUTH_FIXTURE_PASSWORD)
  const uniqueFields: Array<keyof AuthFixture> = ["id", "accountId", "email"]
  expect(fixtures).toEqual(createDemoAuthFixtures(AUTH_FIXTURE_PASSWORD))
  expect(fixtures).toHaveLength(authFixturesConfig.demoCount)
  for (const field of uniqueFields) {
    expect(new Set(AUTH_FIXTURES.map((fixture) => fixture[field])).size).toBe(
      AUTH_FIXTURES.length
    )
  }
  expect(
    fixtures.every((fixture) =>
      fixture.email.endsWith(`@${authFixturesConfig.emailDomain}`)
    )
  ).toBe(true)
  expect(fixtures.some((fixture) => !fixture.emailVerified)).toBe(true)
})
