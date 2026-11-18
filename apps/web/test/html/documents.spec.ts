import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import * as m from "@workspace/i18n/messages"
import { locales, localizeHref } from "@workspace/i18n/runtime"

const directory = process.env.HTML_CHECK_DOCUMENTS
if (!directory) throw new Error("Run pnpm test:html")

test.beforeEach(async ({ context }) => {
  // Unknown API requests never reach a developer's running API.
  await context.route("**/api/**", (route) => route.abort())
})

for (const locale of locales) {
  const href = (path: string) => localizeHref(path, { locale })
  async function save(name: string, html: string) {
    await mkdir(directory!, { recursive: true })
    await writeFile(join(directory!, `${locale}-${name}.html`), html)
  }

  test(`public responses and hydrated routes (${locale})`, async ({ page }) => {
    const cases = [
      ["sign-in", "/sign-in", m.sign_in_title({}, { locale })],
      ["sign-up", "/sign-up", m.sign_up_title({}, { locale })],
      ["verification", "/verify-email", m.verification_title({}, { locale })],
      ["verified", "/email-verified", m.verification_complete({}, { locale })],
      [
        "verification-error",
        "/email-verified?error=fixture",
        m.invalid_link({}, { locale }),
      ],
      ["forgot", "/forgot-password", m.forgot_title({}, { locale })],
      ["reset", "/reset-password?token=fixture", m.reset_title({}, { locale })],
      ["reset-error", "/reset-password", m.reset_title({}, { locale })],
      ["not-found", "/html-fixture-missing", m.not_found_title({}, { locale })],
    ] as const
    const routing = JSON.parse(
      await readFile(
        new URL("../../../../packages/i18n/routing.json", import.meta.url),
        "utf8"
      )
    ) as { routes: { path: string }[] }
    expect(
      [
        "/",
        ...new Set(
          cases
            .filter(([name]) => name !== "not-found")
            .map(([, path]) => path.split("?")[0])
        ),
      ].sort()
    ).toEqual(routing.routes.map(({ path }) => path).sort())
    for (const [name, path, title] of cases) {
      await test.step(name, async () => {
        const response = await page.goto(href(path))
        expect(response?.status()).toBe(name === "not-found" ? 404 : 200)
        await save(`${name}-ssr`, await response!.text())
        await expect(
          page.getByRole("heading", { name: title, exact: true })
        ).toBeVisible()
        await expect(page.locator("html")).toHaveAttribute("lang", locale)
        const submit = page.locator('form button[type="submit"]')
        if (await submit.count()) await expect(submit).toBeEnabled()
        await save(`${name}-dom`, await page.content())
      })
    }
    // The forgot-password view is also reached through client navigation.
    await page.goto(href("/sign-in"))
    await page
      .getByRole("link", { name: m.forgot_password({}, { locale }) })
      .click()
    await expect(
      page.getByRole("heading", { name: m.forgot_title({}, { locale }) })
    ).toBeVisible()
    const submit = page.getByRole("button", {
      name: m.send_reset({}, { locale }),
    })
    await expect(submit).toBeEnabled()
    await page
      .getByLabel(m.email_label({}, { locale }), { exact: true })
      .fill("invalid")
    await submit.click()
    await expect(
      page.getByText(m.invalid_email({}, { locale }), { exact: true })
    ).toBeVisible()
    await save("request-validation-dom", await page.content())
    await page.route("**/api/auth/request-password-reset", (route) =>
      route.fulfill({ json: { status: true } })
    )
    await page
      .getByLabel(m.email_label({}, { locale }), { exact: true })
      .fill("fixture@example.test")
    await submit.click()
    await expect(
      page.getByText(m.email_request_received({}, { locale }), { exact: true })
    ).toBeVisible()
    await save("request-confirmation-dom", await page.content())
  })

  test(`protected table and failure states (${locale})`, async ({ page }) => {
    const user = {
      id: "html-fixture",
      name: "HTML Fixture",
      email: "fixture@example.test",
      emailVerified: true,
    }
    let identityStatus = 200
    let state: "list" | "empty" | "error" = "list"
    await page.route("**/api/me", (route) =>
      route.fulfill({ status: identityStatus, json: user })
    )
    await page.route(/\/api\/users(?:\?.*)?$/, (route) =>
      state === "error"
        ? route.fulfill({ status: 503 })
        : route.fulfill({
            json: { items: state === "list" ? [user] : [], nextCursor: null },
          })
    )
    const response = await page.goto(href("/"))
    expect(response?.status()).toBe(200)
    await save("home-shell", await response!.text())
    await expect(
      page.getByRole("heading", {
        name: m.welcome({ name: user.name }, { locale }),
      })
    ).toBeVisible()
    await expect(page.getByRole("table").getByText(user.email)).toBeVisible()
    await save("home-list-dom", await page.content())

    state = "empty"
    await page.reload()
    await expect(
      page.getByRole("cell", { name: m.users_empty({}, { locale }) })
    ).toBeVisible()
    await save("home-empty-dom", await page.content())
    state = "error"
    await page.reload()
    await expect(
      page.getByText(m.users_error({}, { locale }), { exact: true })
    ).toBeVisible()
    await save("home-table-error-dom", await page.content())
    identityStatus = 503
    await page.reload()
    await expect(
      page.getByRole("heading", { name: m.page_error_title({}, { locale }) })
    ).toBeVisible()
    await save("home-error-dom", await page.content())
    identityStatus = 401
    await page.goto(href("/"))
    await expect(
      page.getByRole("heading", { name: m.sign_in_title({}, { locale }) })
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(href("/sign-in"))
    await save("home-redirect-dom", await page.content())
  })
}
