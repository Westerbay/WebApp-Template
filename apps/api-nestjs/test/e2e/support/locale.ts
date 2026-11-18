import { DEFAULT_LOCALE } from "@workspace/i18n/config"
import { isLocale, localizeHref } from "@workspace/i18n/runtime"
import { origin } from "../../support/auth.harness.js"

const requestedLocale = process.env.AUTH_TEST_LOCALE ?? DEFAULT_LOCALE
if (!isLocale(requestedLocale)) throw new Error("Unsupported test locale")
export const testLocale = requestedLocale

export function publicUrl(path: string) {
  return new URL(localizeHref(path, { locale: testLocale }), origin).href
}
