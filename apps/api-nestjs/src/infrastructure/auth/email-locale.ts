import { DEFAULT_LOCALE } from "@workspace/i18n/config"
import { extractLocaleFromUrl } from "@workspace/i18n/runtime"

export function getAuthEmailLocale(actionUrl: string, webOrigin: string) {
  try {
    const callback = new URL(actionUrl).searchParams.get("callbackURL")
    if (!callback) return DEFAULT_LOCALE
    const callbackUrl = new URL(callback, webOrigin)
    if (callbackUrl.origin !== new URL(webOrigin).origin) return DEFAULT_LOCALE
    return extractLocaleFromUrl(callbackUrl) ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}
