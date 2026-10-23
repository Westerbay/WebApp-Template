import { createAuthSeedScenario } from "./auth/scenario.js"
import type { AuthFixtureStore } from "./auth/scenario.js"
import type { SeedScenario } from "./seed.js"

export function createSeedRegistry(dependencies: {
  authStore: AuthFixtureStore
  hashPassword: (password: string) => Promise<string>
}): ReadonlyArray<SeedScenario> {
  return [
    createAuthSeedScenario(dependencies.authStore, dependencies.hashPassword),
  ]
}
