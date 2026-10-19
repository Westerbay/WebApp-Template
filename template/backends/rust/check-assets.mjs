import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  authPasswordConstraints,
  authTokenConstraints,
} from "../../../packages/contracts/src/auth.constraints.ts"

for (const [locale, source] of [
  ["en", "../../../packages/i18n/messages/en.json"],
  ["fr", "../../locales/fr/messages.json"],
]) {
  const catalog = JSON.parse(
    await readFile(new URL(source, import.meta.url), "utf8")
  )
  const expected = Object.fromEntries(
    Object.entries(catalog).filter(([key]) => key.startsWith("email_"))
  )
  const actual = JSON.parse(
    await readFile(
      new URL(`assets/email.${locale}.json`, import.meta.url),
      "utf8"
    )
  )
  assert.deepEqual(
    actual,
    expected,
    `${locale} Rust email copy must match the template catalog`
  )
}
const settings = await readFile(
  new URL("src/settings.rs", import.meta.url),
  "utf8"
)
for (const [name, expected] of [
  ["PASSWORD_MIN_LENGTH", authPasswordConstraints.minLength],
  ["PASSWORD_MAX_LENGTH", authPasswordConstraints.maxLength],
  ["VERIFICATION_HOURS", authTokenConstraints.emailVerificationExpiresInHours],
  ["RESET_HOURS", authTokenConstraints.resetPasswordExpiresInHours],
]) {
  const value = settings.match(
    new RegExp(`pub const ${name}: (?:usize|i64) = (\\d+);`)
  )?.[1]
  assert.equal(
    Number(value),
    expected,
    `Rust ${name} must match shared constraints`
  )
}
console.log(
  "Rust email catalogs, password bounds and token lifetimes match the template"
)
