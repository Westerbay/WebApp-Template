import { hashPassword } from "better-auth/crypto"

import { withVerifiedDatabaseTarget } from "@workspace/database/target"
import { createSeedRegistry } from "../seeds/registry.js"
import { runSeedCommand } from "../seeds/seed.js"
import { parseSeedCommand } from "./seed-command.js"

const command = parseSeedCommand(process.argv.slice(2))

await withVerifiedDatabaseTarget(process.env, "seed", async (target) => {
  const [{ createDatabase }, { createDrizzleAuthFixtureStore }] =
    await Promise.all([
      import("@workspace/database"),
      import("../seeds/auth/store.js"),
    ])
  const database = createDatabase(target.databaseUrl)

  try {
    await runSeedCommand(
      command,
      createSeedRegistry({
        authStore: createDrizzleAuthFixtureStore(database.db),
        hashPassword,
      })
    )
    console.log(
      command.clean ? "Seed cleanup complete" : "Seed scenarios ready"
    )
  } finally {
    await database.close()
  }
})
