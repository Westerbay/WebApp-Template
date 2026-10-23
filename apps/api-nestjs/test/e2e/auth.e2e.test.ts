import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import * as messages from "@workspace/i18n/messages"
import { DEFAULT_LOCALE } from "@workspace/i18n/config"
import { isLocale, localizeHref } from "@workspace/i18n/runtime"
import { expect as browserExpect, chromium } from "@playwright/test"
import { expect, it } from "vitest"
import { schema } from "@workspace/database"
import { usersTableConfig } from "../../../web/src/features/users/users.config.js"
import { AUTH_FIXTURES } from "../../src/seeds/auth/scenario.js"
import {
  api,
  database,
  latestMailUrl,
  origin,
  password,
  webPort,
} from "../support/auth.harness.js"
import type { Page, Request, Route } from "@playwright/test"

const requestedLocale = process.env.AUTH_TEST_LOCALE ?? DEFAULT_LOCALE
if (!isLocale(requestedLocale)) throw new Error("Unsupported test locale")
const testLocale = requestedLocale

function publicUrl(path: string) {
  return new URL(localizeHref(path, { locale: testLocale }), origin).href
}

async function checkUsersPagination(page: Page) {
  await browserExpect(
    page.getByRole("navigation", {
      name: messages.users_pagination_label({}, { locale: testLocale }),
    })
  ).toBeVisible()
  const pageSize = usersTableConfig.pageSize
  const totalUsers = AUTH_FIXTURES.length + 1
  const lastPage = Math.ceil(totalUsers / pageSize)
  const lastPageSize = totalUsers % pageSize || pageSize
  const table = page.getByRole("table", {
    name: messages.users_title({}, { locale: testLocale }),
  })
  let rejectNextPage = true
  let nextPageRequests = 0

  const handleUsersRequest = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has("cursor")) {
      nextPageRequests += 1
      if (rejectNextPage) {
        rejectNextPage = false
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "SERVICE_UNAVAILABLE" }),
        })
        return
      }
    }
    await route.continue()
  }

  await browserExpect(table).toBeVisible()
  await browserExpect(table.locator("tbody tr")).toHaveCount(pageSize)
  const firstPage = await table.locator("tbody").textContent()
  await browserExpect(
    page.getByRole("button", {
      name: messages.users_previous({}, { locale: testLocale }),
    })
  ).toBeDisabled()
  await page.route("**/api/users?*", handleUsersRequest)
  try {
    await page
      .getByRole("button", {
        name: messages.users_next({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(page.getByRole("alert")).toContainText(
      messages.users_error({}, { locale: testLocale })
    )
    expect(await table.locator("tbody").textContent()).toBe(firstPage)
    await page
      .getByRole("button", { name: messages.retry({}, { locale: testLocale }) })
      .click()
    await browserExpect(
      page.getByRole("status").filter({
        hasText: messages.users_page({ page: 2 }, { locale: testLocale }),
      })
    ).toBeVisible()
    await browserExpect(page.getByRole("alert")).toHaveCount(0)
    expect(await table.locator("tbody").textContent()).not.toBe(firstPage)
    const requestsAfterSecondPage = nextPageRequests
    await page
      .getByRole("button", {
        name: messages.users_previous({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(
      page.getByRole("status").filter({
        hasText: messages.users_page({ page: 1 }, { locale: testLocale }),
      })
    ).toBeVisible()
    expect(await table.locator("tbody").textContent()).toBe(firstPage)
    expect(nextPageRequests).toBe(requestsAfterSecondPage)
    await page
      .getByRole("button", {
        name: messages.users_next({}, { locale: testLocale }),
      })
      .click()
    await browserExpect(
      page.getByRole("status").filter({
        hasText: messages.users_page({ page: 2 }, { locale: testLocale }),
      })
    ).toBeVisible()
    expect(nextPageRequests).toBe(requestsAfterSecondPage)
    let nextUnvisitedPage = 3
    if (lastPage >= nextUnvisitedPage) {
      rejectNextPage = true
      await page
        .getByRole("button", {
          name: messages.users_next({}, { locale: testLocale }),
        })
        .click()
      await browserExpect(page.getByRole("alert")).toContainText(
        messages.users_error({}, { locale: testLocale })
      )
      await page
        .getByRole("button", {
          name: messages.users_previous({}, { locale: testLocale }),
        })
        .click()
      await browserExpect(
        page.getByRole("status").filter({
          hasText: messages.users_page({ page: 1 }, { locale: testLocale }),
        })
      ).toBeVisible()
      await page
        .getByRole("button", {
          name: messages.retry({}, { locale: testLocale }),
        })
        .click()
      await browserExpect(
        page.getByRole("status").filter({
          hasText: messages.users_page({ page: 3 }, { locale: testLocale }),
        })
      ).toBeVisible()
      await browserExpect(page.getByRole("alert")).toHaveCount(0)
      nextUnvisitedPage += 1
    }
    for (
      let pageNumber = nextUnvisitedPage;
      pageNumber <= lastPage;
      pageNumber += 1
    ) {
      await page
        .getByRole("button", {
          name: messages.users_next({}, { locale: testLocale }),
        })
        .click()
      await browserExpect(
        page.getByRole("status").filter({
          hasText: messages.users_page(
            { page: pageNumber },
            { locale: testLocale }
          ),
        })
      ).toBeVisible()
    }
    await browserExpect(table.locator("tbody tr")).toHaveCount(lastPageSize)
    await browserExpect(
      page.getByRole("button", {
        name: messages.users_next({}, { locale: testLocale }),
      })
    ).toBeDisabled()
  } finally {
    await page.unroute("**/api/users?*", handleUsersRequest)
  }
}

async function checkUsersSearch(page: Page) {
  const search = page
    .getByRole("search", {
      name: messages.users_title({}, { locale: testLocale }),
    })
    .getByRole("searchbox", {
      name: messages.users_search_label({}, { locale: testLocale }),
    })
  const table = page.getByRole("table", {
    name: messages.users_title({}, { locale: testLocale }),
  })
  const requests: Array<URL> = []
  const recordRequest = (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname === "/api/users") requests.push(url)
  }
  page.on("request", recordRequest)
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  try {
    await search.fill("bro")
    await page.clock.runFor(200)
    await search.fill("browser@")
    await page.clock.runFor(200)
    await search.fill("browser@example.test")
    await page.clock.runFor(usersTableConfig.searchDebounceMs - 1)
    expect(requests).toHaveLength(0)
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        url.pathname === "/api/users" &&
        url.searchParams.get("search") === "browser@example.test"
      )
    })
    await page.clock.runFor(1)
    await searchResponse
    // Resume notification timers once the debounce boundary has been checked.
    await page.clock.resume()
    await browserExpect(table.locator("tbody tr")).toHaveCount(1)
    await browserExpect(table).toContainText("browser@example.test")
    expect(requests).toHaveLength(1)
    expect(requests[0]?.searchParams.has("cursor")).toBe(false)
    await browserExpect(
      page.getByRole("button", {
        name: messages.users_previous({}, { locale: testLocale }),
      })
    ).toBeDisabled()
    await page.screenshot({
      path: `../../output/playwright/${testLocale}/users-search-mobile.png`,
      fullPage: true,
    })
    await search.fill("no-user-matches-this-search")
    await browserExpect(table).toContainText(
      messages.users_empty({}, { locale: testLocale })
    )
    await search.fill("")
    await browserExpect(table.locator("tbody tr")).toHaveCount(
      usersTableConfig.pageSize
    )
    await browserExpect(
      page.getByRole("status").filter({
        hasText: messages.users_page({ page: 1 }, { locale: testLocale }),
      })
    ).toBeVisible()
    expect(requests).toHaveLength(2)
  } finally {
    page.off("request", recordRequest)
    await page.clock.resume()
  }
}

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
