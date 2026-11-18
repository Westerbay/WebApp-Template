import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { SUPPORTED_LOCALES } from "@workspace/i18n/config"
import { renderAuthEmail } from "../../src/auth-email.js"

for (const locale of SUPPORTED_LOCALES) {
  for (const kind of ["verification", "reset"] as const) {
    it(`renders the ${locale} ${kind} HTML document and preserves its action`, async () => {
      const url = "https://app.example.test/action?token=fixture&source=html"
      const mail = await renderAuthEmail({
        locale,
        kind,
        to: "fixture@example.test",
        url,
      })
      expect(mail.html).toContain(`lang="${locale}"`)
      expect(mail.html).toContain(`href="${url.replaceAll("&", "&amp;")}"`)
      expect(mail.text).toContain(url)
      const directory = process.env.HTML_CHECK_EMAILS
      if (directory) {
        await mkdir(directory, { recursive: true })
        await writeFile(
          join(directory, `nestjs-${locale}-${kind}.html`),
          mail.html
        )
      }
    })
  }
}
