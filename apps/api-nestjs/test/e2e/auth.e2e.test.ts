import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import { localizeHref } from "@workspace/i18n/runtime"
import * as messages from "@workspace/i18n/messages"
import { schema } from "@workspace/database"
import { expect as browserExpect, chromium } from "@playwright/test"
import { expect, it } from "vitest"
import {
  api,
  database,
  latestMailUrl,
  origin,
  password,
  webPort,
} from "../support/auth.harness.js"

import { checkUsersPagination, checkUsersSearch } from "./journeys/users.js"
import { publicUrl, testLocale } from "./support/locale.js"
import type { Page } from "@playwright/test"

it("completes localized signup, verification, reset and logout in a mobile browser", async () => {
  await database.db
    .update(schema.rateLimit)
    .set({ lastRequest: Date.now() - 60000 })
  const browser = await chromium.launch()
  const web = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--config",
      "vite.e2e.config.ts",
      "--port",
      String(webPort),
    ],
    {
      cwd: "../web",
      env: { ...process.env, VITE_API_URL: api },
      stdio: "ignore",
    }
  )
  let page: Page | undefined
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(publicUrl("/sign-in"))).ok
      } catch {
        /* The owned Vite process is still starting. */
      }
      if (ready) break
      if (web.exitCode !== null)
        throw new Error("Test web server exited before startup")
      await delay(200)
    }
    expect(ready).toBe(true)
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    })
    const browserErrors: Array<string> = []
    page.on("pageerror", (error) => {
      browserErrors.push(error.message)
    })
    await page.goto(publicUrl("/sign-up"))
    await browserExpect(
      page.getByLabel(messages.name_label({}, { locale: testLocale }), {
        exact: true,
      })
    ).toBeEnabled()
    expect(browserErrors).toEqual([])
    await browserExpect(page.locator("html")).toHaveAttribute(
      "lang",
      testLocale
    )
    await browserExpect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow"
    )
    await browserExpect(
      page.getByRole("region", {
        name: messages.sign_up_title({}, { locale: testLocale }),
      })
    ).toBeVisible()
    await page.screenshot({
      path: `../../output/playwright/${testLocale}/auth-inscription-mobile.png`,
      fullPage: true,
    })
    await page
      .getByLabel(messages.name_label({}, { locale: testLocale }), {
        exact: true,
      })
      .fill("Élodie")
    await page
      .getByLabel(messages.email_label({}, { locale: testLocale }))
      .fill("browser@example.test")
    const passwordInput = page.getByLabel(
      messages.password_label({}, { locale: testLocale }),
      {
        exact: true,
      }
    )
    await passwordInput.fill(password)
    await browserExpect(passwordInput).toHaveAttribute("type", "password")
    const showPasswordButton = page.getByRole("button", {
      name: messages.password_show({}, { locale: testLocale }),
    })
    await browserExpect(showPasswordButton).toHaveAttribute(
      "aria-controls",
      (await passwordInput.getAttribute("id")) ?? ""
    )
    await showPasswordButton.click()
    await browserExpect(passwordInput).toHaveAttribute("type", "text")
    await browserExpect(passwordInput).toHaveValue(password)
    await page
      .getByRole("button", {
        name: messages.password_hide({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(passwordInput).toHaveAttribute("type", "password")
    await page
      .getByRole("button", {
        name: messages.sign_up({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(page).toHaveURL(publicUrl("/verify-email"))
    await page.goto(await latestMailUrl())
    await browserExpect(
      page.getByRole("heading", {
        name: messages.verification_complete({}, { locale: testLocale }),
      })
    ).toBeVisible()
    await page
      .getByRole("link", {
        name: messages.back_sign_in({}, { locale: testLocale }),
      })
      .click()
    await page
      .getByLabel(messages.email_label({}, { locale: testLocale }))
      .fill("browser@example.test")
    await page
      .getByLabel(messages.password_label({}, { locale: testLocale }), {
        exact: true,
      })
      .fill(password)
    await page
      .getByRole("button", {
        name: messages.sign_in({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(
      page.getByRole("heading", {
        name: messages.welcome({ name: "Élodie" }, { locale: testLocale }),
      })
    ).toBeVisible()
    await checkUsersPagination(page)
    await checkUsersSearch(page)
    await page.screenshot({
      path: `../../output/playwright/${testLocale}/auth-home-mobile.png`,
      fullPage: true,
    })
    await page.route("**/api/auth/sign-out", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "SERVICE_UNAVAILABLE" }),
      })
    )
    await page
      .getByRole("button", {
        name: messages.sign_out({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(
      page.getByRole("heading", {
        name: messages.welcome({ name: "Élodie" }, { locale: testLocale }),
      })
    ).toBeVisible()
    await browserExpect(
      page.locator("[data-sonner-toast][data-type='error']")
    ).toHaveCount(1)
    await page.unroute("**/api/auth/sign-out")
    await page
      .getByRole("button", {
        name: messages.sign_out({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(page).toHaveURL(
      (url) =>
        url.origin === origin &&
        url.pathname === localizeHref("/sign-in", { locale: testLocale }) &&
        (url.search === "" || url.searchParams.get("redirect") === "/")
    )
    await page.screenshot({
      path: `../../output/playwright/${testLocale}/auth-connexion-mobile.png`,
      fullPage: true,
    })
    await page
      .getByRole("link", {
        name: messages.forgot_password({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(page).toHaveURL(publicUrl("/forgot-password"))
    await browserExpect(
      page.getByRole("heading", {
        name: messages.forgot_title({}, { locale: testLocale }),
      })
    ).toBeVisible()
    await page
      .getByLabel(messages.email_label({}, { locale: testLocale }))
      .fill("browser@example.test")
    await page
      .getByRole("button", {
        name: messages.send_reset({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(page.locator("main")).toContainText(
      messages.email_request_received({}, { locale: testLocale })
    )
    await page.goto(await latestMailUrl())
    await page
      .getByLabel(messages.new_password_label({}, { locale: testLocale }), {
        exact: true,
      })
      .fill("Browser-New-Password-2026!")
    await page
      .getByLabel(messages.confirm_password_label({}, { locale: testLocale }))
      .fill("Browser-New-Password-2026!")
    await page
      .getByRole("button", {
        name: messages.reset_submit({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(page).toHaveURL(
      (url) =>
        url.origin === origin &&
        url.pathname === localizeHref("/sign-in", { locale: testLocale }) &&
        (url.search === "" || url.searchParams.get("redirect") === "/")
    )
    const popoverColor = await page
      .locator("html")
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--popover").trim()
      )
    await browserExpect(page.locator("[data-sonner-toaster]")).toHaveCSS(
      "--normal-bg",
      popoverColor
    )
    await page
      .getByLabel(messages.email_label({}, { locale: testLocale }))
      .fill("browser@example.test")
    await page
      .getByLabel(messages.password_label({}, { locale: testLocale }), {
        exact: true,
      })
      .fill("Browser-New-Password-2026!")
    await page
      .getByRole("button", {
        name: messages.sign_in({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(
      page.getByRole("heading", {
        name: messages.welcome({ name: "Élodie" }, { locale: testLocale }),
      })
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
  } catch (error) {
    if (page) {
      try {
        await page.screenshot({
          path: `../../output/playwright/${testLocale}/auth-failure.png`,
          fullPage: true,
        })
      } catch (screenshotError) {
        throw new AggregateError(
          [error, screenshotError],
          "E2E failed and its failure screenshot could not be saved"
        )
      }
    }
    throw error
  } finally {
    await browser.close()
    web.kill("SIGTERM")
  }
}, 60000)
