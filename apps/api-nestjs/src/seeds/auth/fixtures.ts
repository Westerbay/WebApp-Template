import { Faker, en, fr } from "@faker-js/faker"
import { authFixturesConfig } from "./fixtures.config.js"
import type { AuthFixture } from "./scenario.js"

export function createDemoAuthFixtures(password: string): Array<AuthFixture> {
  const faker = new Faker({ locale: [fr, en] })
  faker.seed(authFixturesConfig.randomSeed)
  return Array.from({ length: authFixturesConfig.demoCount }, (_, index) => {
    const number = String(index + 1).padStart(authFixturesConfig.idDigits, "0")
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    return {
      id: `seed-auth-user-demo-${number}`,
      accountId: `seed-auth-account-demo-${number}`,
      name: `${firstName} ${lastName}`,
      email: faker.internet
        .email({
          firstName,
          lastName,
          provider: authFixturesConfig.emailDomain,
        })
        .replace("@", `.${number}@`)
        .toLowerCase(),
      emailVerified: index % authFixturesConfig.unverifiedEvery !== 0,
      password,
    }
  })
}
