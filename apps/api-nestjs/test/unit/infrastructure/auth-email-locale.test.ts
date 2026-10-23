import { expect, it } from "vitest"
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@workspace/i18n/config"
import { localizeUrl } from "@workspace/i18n/runtime"
import { getAuthEmailLocale } from "../../../src/infrastructure/auth/email-locale.js"

it("uses a supported callback locale only under the trusted web origin", () => {
  const origin = "https://app.example.test"
  const action = new URL("https://api.example.test/api/auth/verify-email")
  for (const locale of SUPPORTED_LOCALES) {
    const callback = localizeUrl(new URL(`${origin}/email-verified`), {
      locale,
    })
    action.searchParams.set("callbackURL", callback.href)
    expect(getAuthEmailLocale(action.href, origin)).toBe(locale)
  }
  action.searchParams.set(
    "callbackURL",
    "https://external.example/fr/connexion"
  )
  expect(getAuthEmailLocale(action.href, origin)).toBe(DEFAULT_LOCALE)
  expect(getAuthEmailLocale("invalid", origin)).toBe(DEFAULT_LOCALE)
})
