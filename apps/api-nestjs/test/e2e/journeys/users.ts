import { expect as browserExpect } from "@playwright/test"
import * as messages from "@workspace/i18n/messages"
import { expect } from "vitest"
import { usersTableConfig } from "../../../../web/src/features/users/users.config.js"
import { AUTH_FIXTURES } from "../../../src/seeds/auth/scenario.js"

import { testLocale } from "../support/locale.js"
import type { Page, Request, Route } from "@playwright/test"

export async function checkUsersPagination(page: Page) {
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

export async function checkUsersSearch(page: Page) {
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
