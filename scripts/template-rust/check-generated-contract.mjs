import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire, stripTypeScriptTypes } from "node:module"
import { pathToFileURL } from "node:url"

const contracts = createRequire(
  new URL("../../packages/contracts/package.json", import.meta.url)
)
const zodPackage = contracts.resolve("zod/package.json")
const zodMetadata = JSON.parse(await readFile(zodPackage, "utf8"))
const zodModule = new URL(
  zodMetadata.exports["."].import,
  pathToFileURL(zodPackage)
)
const generated = await readFile(
  new URL("../../output/rust-auth-prototype/identity.zod.ts", import.meta.url),
  "utf8"
)
// Run the actual generated validator with the workspace's Zod, without adding
// a second dependency installation or modifying the generated source on disk.
const javascript = stripTypeScriptTypes(generated).replace(
  /from ['"]zod['"]/g,
  `from ${JSON.stringify(zodModule.href)}`
)
const { MeResponse } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
)
const identity = {
  id: "prototype-user",
  name: "Alice",
  email: "alice@example.test",
  emailVerified: true,
}
assert(MeResponse.safeParse(identity).success)
assert(!MeResponse.safeParse({ ...identity, emailVerified: "true" }).success)
assert(!MeResponse.safeParse({ ...identity, email: "invalid" }).success)
assert(!MeResponse.safeParse({ ...identity, name: undefined }).success)
console.log(
  "Generated Zod validator accepts identity and rejects invalid contracts"
)
