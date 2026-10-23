import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  authPasswordConstraints,
  authTokenConstraints,
} from "../../packages/contracts/src/auth.constraints.ts"

const root = resolve(import.meta.dirname, "../..")
const write = process.argv[2] === "--write"
const readJson = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"))
const { locales } = await readJson("packages/i18n/project.inlang/settings.json")
for (const locale of locales) {
  const catalog = await readJson(`packages/i18n/messages/${locale}.json`)
  const expected = Object.fromEntries(
    Object.entries(catalog).filter(([key]) => key.startsWith("email_"))
  )
  const path = `apps/api/assets/email.${locale}.json`
  if (write)
    await writeFile(
      resolve(root, path),
      JSON.stringify(expected, null, 2) + "\n"
    )
  else
    assert.deepEqual(
      await readJson(path),
      expected,
      `Email catalog drift: ${locale}; run pnpm api:generate`
    )
}
const path = resolve(root, "apps/api/src/config/auth.rs")
let settings = await readFile(path, "utf8")
for (const [name, expected] of [
  ["PASSWORD_MIN_LENGTH", authPasswordConstraints.minLength],
  ["PASSWORD_MAX_LENGTH", authPasswordConstraints.maxLength],
  ["VERIFICATION_HOURS", authTokenConstraints.emailVerificationExpiresInHours],
  ["RESET_HOURS", authTokenConstraints.resetPasswordExpiresInHours],
]) {
  const pattern = new RegExp(`(pub const ${name}: (?:usize|i64) = )(\\d+);`)
  const actual = settings.match(pattern)?.[2]
  assert.ok(actual, `Missing Rust constraint: ${name}`)
  if (write)
    settings = settings.replace(pattern, (_, prefix) => `${prefix}${expected};`)
  else
    assert.equal(
      Number(actual),
      expected,
      `Rust ${name} drift; run pnpm api:generate`
    )
}
if (write) await writeFile(path, settings)
console.log("Rust email catalogs and auth constraints synchronized")
